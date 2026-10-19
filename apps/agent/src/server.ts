// Countersign agent service (apps/agent). No database, no Stellar key, no
// manager routes: it talks to the Countersign API only with the investor's
// agent scope token, received in each request and never stored.
//
// Routes (the contract with the web app):
//   POST /chat                    { sessionId, message }   Authorization: Bearer <agent token>
//   GET  /session/:id             { mandateDraft, missingFields, plan, turns, lastToolCalls, pendingAction, transcript }
//   POST /session/:id/interrupt   freezes the plan (no execution while interrupted)
//   POST /session/:id/resume      continues from the node where it stopped
//   POST /session/:id/recurring   pre authorised recurring purchase, same path as chat, hold window before execution
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ApiClient, ApiError, type FetchLike } from "./api/client.js";
import { config, hasAnthropicKey } from "./config.js";
import { runTurn } from "./agent/loop.js";
import { RECURRING_LABEL, executeRecurring, proposeRecurring } from "./agent/recurring.js";
import { AnthropicLlmClient } from "./llm/anthropic.js";
import { LlmUnavailableError, type LlmClient } from "./llm/types.js";
import { interruptPlan, planView, resumePlan } from "./plan/dag.js";
import { PROMPT_VERSION } from "./prompt.js";
import { PayloadLeakError } from "./safety/minimize.js";
import { AuthError, confirmTokenWithApi, readAgentClaims } from "./session/auth.js";
import { SESSION_ID, SessionStore, computePendingAction, tokenFingerprint, type Session } from "./session/store.js";

export interface ServerDeps {
  llm?: LlmClient;
  store?: SessionStore;
  apiBaseUrl?: string;
  /** Injected fetch for the Countersign API (tests). */
  fetch?: FetchLike;
  logger?: boolean;
  /** Timeout of each call to the Countersign API (default 30 s). */
  apiTimeoutMs?: number;
  /** Time between the recurring proposal and its execution, during which the investor can interrupt. */
  recurringHoldMs?: number;
}

const ChatBody = z
  .object({
    sessionId: z.string().regex(SESSION_ID, "sessionId: 8 to 80 letters, digits, _ or -"),
    message: z.string().trim().min(1).max(4000),
  })
  .strict();

const LAST_TOOL_CALLS = 20;

export function sessionView(s: Session) {
  return {
    sessionId: s.id,
    mandateDraft: s.mandate?.draft ?? null,
    mandateStatus: s.mandate?.status ?? null,
    missingFields: s.mandate?.missingFields ?? null,
    plan: planView(s.plan),
    turns: s.turns,
    lastToolCalls: s.toolLog.slice(-LAST_TOOL_CALLS),
    pendingAction: computePendingAction(s),
    interrupted: s.plan.interrupted,
    transcript: s.transcript,
    updatedAt: s.updatedAt,
  };
}

export function buildServer(deps: ServerDeps = {}) {
  // Default request logging records method and url only, never headers, so the
  // agent scope token in Authorization does not reach the log.
  const app = Fastify({ logger: deps.logger ?? true });
  const llm = deps.llm ?? new AnthropicLlmClient();
  const store = deps.store ?? new SessionStore(config.sessionsDir);
  const apiBaseUrl = deps.apiBaseUrl ?? config.apiBaseUrl;
  const holdMs = deps.recurringHoldMs ?? config.recurringHoldMs;
  // Scheduled recurring executions. The agent token lives only in this closure, in memory, until it runs.
  const timers = new Map<string, NodeJS.Timeout>();
  app.addHook("onClose", async () => {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  });
  const apiFor = (token: string) => new ApiClient({ baseUrl: apiBaseUrl, agentToken: token, fetch: deps.fetch, timeoutMs: deps.apiTimeoutMs });

  // Minimal CORS for the web app (single allowed origin, no credentials).
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && origin === config.corsOrigin) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
      reply.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
      reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    if (request.method === "OPTIONS") return reply.status(204).send();
  });

  /** Authenticates the request and binds it to the session owner. */
  async function authorize(request: FastifyRequest, session: Session | undefined) {
    const { token, claims } = readAgentClaims(request.headers.authorization);
    if (session && session.ownerUserId !== claims.userId) {
      throw new AuthError(403, "This session belongs to another investor.");
    }
    const fp = tokenFingerprint(token);
    if (!session || !session.verifiedTokenFingerprints.includes(fp)) {
      await confirmTokenWithApi(apiBaseUrl, token, deps.fetch);
    }
    return { token, claims, fingerprint: fp };
  }

  function sendError(reply: FastifyReply, err: unknown) {
    if (err instanceof AuthError) return reply.status(err.status).send({ error: err.message });
    if (err instanceof LlmUnavailableError) {
      return reply.status(502).send({
        error: "The language model is not available right now; nothing was proposed or bought.",
        reason: err.status === 401 ? "provider authentication failed" : "provider error",
      });
    }
    if (err instanceof PayloadLeakError) {
      return reply.status(500).send({ error: "Blocked: the request to the language model contained data that must not leave this service." });
    }
    if (err instanceof ApiError) return reply.status(502).send({ error: `Countersign API: ${err.safeMessage}` });
    app.log.error(err);
    return reply.status(500).send({ error: "Internal error" });
  }

  app.get("/health", async () => ({
    ok: true,
    model: config.model,
    effort: config.effort,
    promptVersion: PROMPT_VERSION,
    llm: llm.kind,
    anthropicKeyConfigured: hasAnthropicKey(),
  }));

  app.post("/chat", async (request, reply) => {
    const body = ChatBody.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: "Send { sessionId, message }", details: body.error.issues });
    const { sessionId, message } = body.data;
    try {
      return await store.withLock(sessionId, async () => {
        const existing = store.get(sessionId);
        const { token, claims, fingerprint } = await authorize(request, existing);
        const session = existing ?? store.create(sessionId, claims.userId);
        if (!session.verifiedTokenFingerprints.includes(fingerprint)) {
          session.verifiedTokenFingerprints = [...session.verifiedTokenFingerprints.slice(-4), fingerprint];
        }
        const api = apiFor(token);
        const result = await runTurn(session, message, { llm, api, store, agentToken: token });
        return {
          reply: result.reply,
          turn: result.turn,
          flags: result.flags,
          toolCalls: result.toolCalls,
          ...sessionView(session),
        };
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/session/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = store.get(id);
    try {
      if (!session) {
        readAgentClaims(request.headers.authorization);
        return reply.status(404).send({ error: "No such session" });
      }
      await authorize(request, session);
      return sessionView(session);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  const control = (action: "interrupt" | "resume") => async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    try {
      return await store.withLock(id, async () => {
        const session = store.get(id);
        if (!session) {
          readAgentClaims(request.headers.authorization);
          return reply.status(404).send({ error: "No such session" });
        }
        const { token } = await authorize(request, session);
        if (action === "interrupt") {
          interruptPlan(session.plan);
          store.save(session);
          return sessionView(session);
        }
        resumePlan(session.plan);
        store.save(session);
        // Continue from where it stopped: a pending recurring decision is executed now.
        const pending = computePendingAction(session);
        const d = pending?.kind === "awaiting_execution" ? session.decisions.find((x) => x.seq === pending.decisionSeq) : undefined;
        if (d?.origin === "recurring") {
          clearTimeout(timers.get(session.id));
          timers.delete(session.id);
          await executeRecurring(session, apiFor(token), store, d.seq);
        }
        return sessionView(session);
      });
    } catch (err) {
      return sendError(reply, err);
    }
  };
  app.post("/session/:id/interrupt", control("interrupt"));
  app.post("/session/:id/resume", control("resume"));

  // Line 3.1: "run recurring now: pre-authorised within mandate". Same path as a chat purchase
  // (propose_subscription with origin "recurring" and amountSource "mandate", then execution), no LLM, no new
  // signature; execution waits holdMs so the investor can interrupt it.
  const RecurringBody = z.object({ fundId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional() }).strict();
  app.post("/session/:id/recurring", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = RecurringBody.safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ error: "Send {} or { fundId }" });
    try {
      return await store.withLock(id, async () => {
        const existing = store.get(id);
        const { token, claims } = await authorize(request, existing);
        const session = existing ?? store.create(id, claims.userId);
        if (session.plan.interrupted) {
          return reply.status(409).send({ error: "The session is interrupted; resume it before running a recurring purchase.", ...sessionView(session) });
        }
        if (timers.has(session.id)) {
          return reply.status(409).send({ error: "A recurring purchase is already waiting to execute.", ...sessionView(session) });
        }
        const api = apiFor(token);
        const result = await proposeRecurring(session, api, body.data.fundId);
        if (result.status === "scheduled" && result.decision) {
          const seq = result.decision.seq;
          result.holdMs = holdMs;
          result.message = `Recurring purchase approved by the policy (\`${result.decision.rule}\`). It executes in ${Math.round(holdMs / 1000)} seconds unless the investor interrupts it.`;
          session.transcript.push({ role: "agent", text: result.message, turn: session.turns, at: new Date().toISOString(), flags: ["recurring"] });
          const timer = setTimeout(() => {
            timers.delete(session.id);
            store
              .withLock(session.id, () => executeRecurring(session, api, store, seq))
              .catch((err) => app.log.error(err));
          }, holdMs);
          timers.set(session.id, timer);
        }
        store.save(session);
        return reply.status(result.status === "scheduled" ? 202 : 200).send({ recurring: result, label: RECURRING_LABEL, ...sessionView(session) });
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  return app;
}

const isEntrypoint =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isEntrypoint) {
  const app = buildServer();
  app.listen({ port: config.port, host: "0.0.0.0" }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
