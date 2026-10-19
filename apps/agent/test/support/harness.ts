// Builds the agent server with a scripted LLM client, the fixture API and a
// temporary sessions directory.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedLlmClient, type ScriptStep } from "../../src/llm/scripted.js";
import type { LlmClient, LlmRequest } from "../../src/llm/types.js";
import { buildServer } from "../../src/server.js";
import { SessionStore } from "../../src/session/store.js";
import { FixtureApi, fixtureToken, type FixtureApiOptions } from "./fixtureApi.js";

export const API_BASE = "http://api.fixture.local/api";

export interface Harness {
  app: ReturnType<typeof buildServer>;
  llm: ScriptedLlmClient;
  api: FixtureApi;
  token: string;
  otherToken: string;
  sessionsDir: string;
  chat: (message: string, sessionId?: string, token?: string) => Promise<{ status: number; body: any }>;
  session: (sessionId?: string, token?: string) => Promise<{ status: number; body: any }>;
  close: () => Promise<void>;
}

export const SESSION = "session_fixture_0001";

export function makeHarness(
  steps: ScriptStep[],
  apiOpts: Partial<FixtureApiOptions> = {},
  llmOverride?: LlmClient,
  serverOpts: { recurringHoldMs?: number; apiTimeoutMs?: number } = {},
): Harness {
  const token = fixtureToken("user_fixture");
  const otherToken = fixtureToken("user_other");
  const api = new FixtureApi({ validTokens: [token, otherToken], ...apiOpts });
  const llm = new ScriptedLlmClient(steps);
  const sessionsDir = mkdtempSync(join(tmpdir(), "countersign-agent-test-"));
  const app = buildServer({
    llm: llmOverride ?? llm,
    store: new SessionStore(sessionsDir),
    apiBaseUrl: API_BASE,
    fetch: api.fetch,
    logger: false,
    recurringHoldMs: serverOpts.recurringHoldMs ?? 50,
    apiTimeoutMs: serverOpts.apiTimeoutMs,
  });
  return {
    app,
    llm,
    api,
    token,
    otherToken,
    sessionsDir,
    async chat(message, sessionId = SESSION, tk = token) {
      const res = await app.inject({
        method: "POST",
        url: "/chat",
        headers: { authorization: `Bearer ${tk}` },
        payload: { sessionId, message },
      });
      return { status: res.statusCode, body: res.json() };
    },
    async session(sessionId = SESSION, tk = token) {
      const res = await app.inject({ method: "GET", url: `/session/${sessionId}`, headers: { authorization: `Bearer ${tk}` } });
      return { status: res.statusCode, body: res.json() };
    },
    async close() {
      await app.close();
      rmSync(sessionsDir, { recursive: true, force: true });
    },
  };
}

/** Parsed tool results of the last user message of a request. */
export function lastToolResults(req: LlmRequest): Array<{ tool_use_id: string; is_error?: boolean; content: any }> {
  const users = req.messages.filter((m) => m.role === "user");
  const last = users[users.length - 1];
  if (!last || typeof last.content === "string") return [];
  return (last.content as any[])
    .filter((b) => b.type === "tool_result")
    .map((b) => ({ tool_use_id: b.tool_use_id, is_error: b.is_error, content: JSON.parse(b.content) }));
}

export const FULL_MANDATE = {
  residences: ["HK"],
  horizonMonths: 24,
  liquidityNeedPct: 20,
  liquidityWithinMonths: 6,
  maxLossTolerance: "MEDIUM",
  totalAmountUsdc: "1000",
  perPurchaseCapUsdc: "500",
  periodCapUsdc: "1000",
  periodDays: 30,
  allowedSectors: ["AGRO", "SERVICOS"],
  maxPerSectorPct: 60,
  recurring: null,
  removeRecurring: false,
};

export const EMPTY_MANDATE_PATCH = Object.fromEntries(Object.keys(FULL_MANDATE).map((k) => [k, k === "removeRecurring" ? false : null]));
