// Live smoke test of build line 1.6 against the real Claude model.
// Same flow as test/flow.test.ts, with the real Anthropic client instead of
// the scripted one.
//
//   npm run smoke:live -- --fixture-api   Claude real, in process fixture API (needs only ANTHROPIC_API_KEY)
//   npm run smoke:live                    Claude real, real API at API_BASE_URL; needs AGENT_TOKEN in the
//                                         shell environment (an agent scope token from POST /api/agent/session-token)
//
// Neither the Anthropic key nor the agent token is printed or written. The
// evidence file holds tool names, minimised tool outputs, replies and usage.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ApiClient } from "../src/api/client.js";
import { runTurn } from "../src/agent/loop.js";
import { config, hasAnthropicKey } from "../src/config.js";
import { AnthropicLlmClient } from "../src/llm/anthropic.js";
import { FALLBACK_BETA } from "../src/llm/client.js";
import { isConfirmed } from "../src/plan/dag.js";
import { PROMPT_VERSION } from "../src/prompt.js";
import { findLeaks } from "../src/safety/minimize.js";
import { SessionStore } from "../src/session/store.js";
import { FixtureApi, fixtureToken } from "../test/support/fixtureApi.js";

const here = dirname(fileURLToPath(import.meta.url));
const useFixture = process.argv.includes("--fixture-api");

const TURNS = [
  "Hi, I live in Hong Kong. I want to put 1000 USDC into receivables over 2 years, at most 500 per purchase and 1000 per 30 days, agri and services only, max 60% in one sector, medium loss tolerance, I may need 20% back within 6 months. No recurring purchases.",
  "Show me the funds and quote 500 USDC of the agri fund.",
  "OK, propose 500 USDC of the agri fund.",
];

async function main() {
  if (!hasAnthropicKey()) {
    console.error("ANTHROPIC_API_KEY is not set (apps/agent/.env). Aborting.");
    process.exit(1);
  }
  let api: ApiClient;
  let token: string;
  if (useFixture) {
    token = fixtureToken("user_smoke");
    const fixture = new FixtureApi({ validTokens: [token] });
    api = new ApiClient({ baseUrl: "http://api.fixture.local/api", agentToken: token, fetch: fixture.fetch });
  } else {
    const t = process.env.AGENT_TOKEN?.trim();
    if (!t) {
      console.error("AGENT_TOKEN is not set. Export an agent scope token, or run with --fixture-api.");
      process.exit(1);
    }
    token = t;
    api = new ApiClient({ baseUrl: config.apiBaseUrl, agentToken: token });
  }

  const store = new SessionStore(null);
  const session = store.create(`smoke_${Date.now()}`, "smoke");
  const llm = new AnthropicLlmClient();
  console.log(`model=${config.model} effort=${config.effort} prompt=${PROMPT_VERSION} api=${useFixture ? "fixture" : config.apiBaseUrl}`);

  const turns = [];
  for (const message of TURNS) {
    const t0 = Date.now();
    try {
      const r = await runTurn(session, message, { llm, api, store, agentToken: token });
      const u = session.usage[session.usage.length - 1];
      console.log(`\n> ${message}\n< ${r.reply}`);
      console.log(
        `  tools=${r.toolCalls.map((c) => `${c.tool}${c.isError ? "(error)" : ""}`).join(",") || "none"} flags=${r.flags.join(",") || "none"} servedBy=${r.servedBy} ${Date.now() - t0}ms cacheRead=${u.cacheReadInputTokens} cacheWrite=${u.cacheCreationInputTokens}`,
      );
      turns.push({ message, reply: r.reply, flags: r.flags, toolCalls: r.toolCalls, usage: u });
    } catch (err) {
      console.error(`turn failed: ${(err as Error).message}`);
      turns.push({ message, error: (err as Error).message });
      break;
    }
  }

  if (turns.some((t) => "error" in t)) {
    console.error("smoke incomplete: a turn failed (see above). No evidence written.");
    process.exit(1);
  }

  const called = new Set(session.toolLog.map((c) => c.tool));
  const checks = {
    calledGetMandate: called.has("get_mandate"),
    calledListFunds: called.has("list_funds"),
    calledQuote: called.has("quote_subscription"),
    calledPropose: called.has("propose_subscription"),
    noLeaksInHistory: findLeaks(session.messages, [token]).length === 0,
    neverConfirmedWithoutStatus: !isConfirmed(session.plan) || called.has("get_status"),
    anyCacheRead: session.usage.some((u) => u.cacheReadInputTokens > 0),
  };
  console.log("\nchecks", JSON.stringify(checks, null, 2));
  console.log("plan", session.plan.nodes.map((n) => `${n.id}:${n.state}${n.rule ? `(${n.rule})` : ""}`).join(" "));

  const dir = resolve(here, "..", "evidence");
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `smoke-live${useFixture ? "-fixture" : ""}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        smoke: "1.6",
        at: new Date().toISOString(),
        model: config.model,
        effort: config.effort,
        promptVersion: PROMPT_VERSION,
        fallback: { fallbacks: "default", beta: FALLBACK_BETA },
        api: useFixture ? "fixture" : "real",
        turns,
        checks,
        plan: session.plan.nodes,
      },
      null,
      2,
    ),
  );
  console.log(`evidence written to ${file}`);
  if (!checks.noLeaksInHistory) process.exit(2);
}

main().catch((err) => {
  console.error(`smoke failed: ${(err as Error).message}`);
  process.exit(1);
});
