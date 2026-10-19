// Runtime configuration of the agent service.
// Secrets are read from the environment only. Nothing in this module logs or
// returns the value of ANTHROPIC_API_KEY: callers only learn whether it is set.
import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// apps/agent/.env (one level above src/ and scripts/). Existing env vars win.
loadDotenv({ path: resolve(here, "..", ".env"), quiet: true });

export const DEFAULT_MODEL = "claude-opus-5-5";

export type Effort = "low" | "medium" | "high";

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export const config = {
  model: nonEmpty(process.env.AGENT_MODEL) ?? DEFAULT_MODEL,
  apiBaseUrl: nonEmpty(process.env.API_BASE_URL) ?? "http://localhost:3001/api",
  port: Number(nonEmpty(process.env.PORT) ?? 3002),
  // Provisional: the S3 latency measurement is still pending (the key returned 401).
  effort: "low" as Effort,
  /** Local session dumps (gitignored). */
  sessionsDir: nonEmpty(process.env.AGENT_SESSIONS_DIR) ?? resolve(here, "..", "sessions"),
  /** Optional demo catalog with fixed per fund texts (owned by agent-architect, seeded by test-engineer). */
  demoCatalogPath:
    nonEmpty(process.env.DEMO_CATALOG_PATH) ??
    resolve(here, "..", "..", "api", "scripts", "countersign-demo-funds.json"),
  /** Browser origin allowed to call this service (the Vite dev server of apps/new_web). */
  corsOrigin: nonEmpty(process.env.CORS_ORIGIN) ?? "http://localhost:5173",
  /** Upper bound of model calls inside one investor turn. */
  maxStepsPerTurn: 8,
  /** Seconds between a recurring proposal and its execution (interrupt window). */
  recurringHoldMs: Number(nonEmpty(process.env.RECURRING_HOLD_MS) ?? 15_000),
};

export function hasAnthropicKey(): boolean {
  return nonEmpty(process.env.ANTHROPIC_API_KEY) !== undefined;
}
