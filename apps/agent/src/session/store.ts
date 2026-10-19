// Sessions live in memory and are dumped to apps/agent/sessions/<id>.json
// (gitignored) after every change, so a restart keeps the conversation. The
// agent token is never stored: only the owner's user id (from a token the API
// accepted) and short fingerprints of tokens already verified.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LlmMessage } from "../llm/types.js";
import { newPlan, type Plan } from "../plan/dag.js";
import type { MandateView } from "../tools/projections.js";
import type { SessionDecision, ToolCallLog } from "../tools/types.js";

export const SESSION_ID = /^[A-Za-z0-9_-]{8,80}$/;

export interface TranscriptEntry {
  role: "investor" | "agent";
  text: string;
  turn: number;
  at: string;
  /** Flags raised by the reply checks (agent entries only). */
  flags?: string[];
}

export interface TurnUsage {
  turn: number;
  servedBy: string;
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  steps: number;
  durationMs: number;
}

export interface Session {
  id: string;
  ownerUserId: string;
  verifiedTokenFingerprints: string[];
  createdAt: string;
  updatedAt: string;
  /** Number of investor messages answered in this session; never reset by corrections. */
  turns: number;
  /** Conversation as sent to the LLM (already minimised). */
  messages: LlmMessage[];
  transcript: TranscriptEntry[];
  toolLog: ToolCallLog[];
  usage: TurnUsage[];
  mandate: MandateView | null;
  plan: Plan;
  /** Policy decisions returned in this session, in order. */
  decisions: SessionDecision[];
  /** Platform notes (for example a recurring run) passed to the LLM with the next investor message. */
  pendingNotes: string[];
  /** Set once a residence in Mainland China is declared; sticky for the session. */
  perimeterRefused: boolean;
  /** What the investor's screen must show next, derived from the latest decision (see computePendingAction). */
  pendingAction: PendingAction | null;
}

export interface PendingAction {
  kind: "awaiting_execution" | "needs_investor_signature";
  decisionSeq: number;
  fundId: string;
}

/**
 * Derived from the latest decision of the session:
 *  APPROVED and not executed yet  -> awaiting_execution (the agent executes it, unless interrupted)
 *  NEEDS_INVESTOR_SIGNATURE       -> needs_investor_signature (she signs allow_fund; then a NEW proposal is made,
 *                                    because this decision is not executable)
 */
export function computePendingAction(s: Pick<Session, "decisions">): PendingAction | null {
  const last = s.decisions[s.decisions.length - 1];
  if (!last || last.execution) return null;
  if (last.outcome === "APPROVED" && !last.execution) {
    return { kind: "awaiting_execution", decisionSeq: last.seq, fundId: last.fundId };
  }
  if (last.outcome === "NEEDS_INVESTOR_SIGNATURE") {
    return { kind: "needs_investor_signature", decisionSeq: last.seq, fundId: last.fundId };
  }
  return null;
}

export function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly dir: string | null) {
    if (dir) mkdirSync(dir, { recursive: true });
  }

  get(id: string): Session | undefined {
    if (!SESSION_ID.test(id)) return undefined;
    const cached = this.sessions.get(id);
    if (cached) return cached;
    if (!this.dir) return undefined;
    const file = join(this.dir, `${id}.json`);
    if (!existsSync(file)) return undefined;
    try {
      const s = JSON.parse(readFileSync(file, "utf8")) as Session;
      s.decisions ??= [];
      s.pendingNotes ??= [];
      s.perimeterRefused ??= false;
      s.pendingAction = computePendingAction(s);
      this.sessions.set(id, s);
      return s;
    } catch {
      return undefined;
    }
  }

  create(id: string, ownerUserId: string): Session {
    const at = new Date().toISOString();
    const s: Session = {
      id,
      ownerUserId,
      verifiedTokenFingerprints: [],
      createdAt: at,
      updatedAt: at,
      turns: 0,
      messages: [],
      transcript: [],
      toolLog: [],
      usage: [],
      mandate: null,
      plan: newPlan(),
      decisions: [],
      pendingNotes: [],
      perimeterRefused: false,
      pendingAction: null,
    };
    this.sessions.set(id, s);
    this.save(s);
    return s;
  }

  save(s: Session): void {
    s.updatedAt = new Date().toISOString();
    if (!this.dir) return;
    const file = join(this.dir, `${s.id}.json`);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(s, null, 2));
    renameSync(tmp, file);
  }

  /** Runs jobs of one session one at a time (two chats on one session never interleave). */
  withLock<T>(id: string, job: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(job);
    this.locks.set(id, next);
    next
      .finally(() => {
        if (this.locks.get(id) === next) this.locks.delete(id);
      })
      .catch(() => undefined);
    return next;
  }
}
