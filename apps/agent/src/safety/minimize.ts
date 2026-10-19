// Data minimisation for everything that goes to the language model
// (known limitation 11): the investor's messages and typed tool results are
// sent; addresses, keys, e mail addresses and tokens are removed first; no
// private key and no identity document.
//
// Three layers:
//  1. Projection: each tool builds its result from an explicit allow list of
//     fields (see tools/projections.ts). Raw API objects never reach the LLM.
//  2. Scrubbing: every string that reaches the LLM (tool results and the
//     investor's own message) goes through scrubText, which replaces Stellar
//     account ids, contract ids, secret seeds, muxed accounts, e mail
//     addresses, JWTs and Anthropic keys with neutral labels.
//  3. Fail closed: assertLlmPayloadClean runs on the fully assembled request
//     right before it is sent; if anything slipped through, the call is
//     aborted instead of sent.

export const PATTERNS = {
  stellarAccount: /\bG[A-Z2-7]{55}\b/g,
  stellarContract: /\bC[A-Z2-7]{55}\b/g,
  stellarSecret: /\bS[A-Z2-7]{55}\b/g,
  stellarMuxed: /\bM[A-Z2-7]{68}\b/g,
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  jwt: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
  anthropicKey: /\bsk-ant-[A-Za-z0-9_-]+/g,
} as const;

const REPLACEMENTS: Record<keyof typeof PATTERNS, string> = {
  stellarAccount: "[account address removed]",
  stellarContract: "[contract address removed]",
  stellarSecret: "[secret removed]",
  stellarMuxed: "[account address removed]",
  email: "[email removed]",
  jwt: "[token removed]",
  anthropicKey: "[secret removed]",
};

export function scrubText(text: string): string {
  let out = text;
  for (const key of Object.keys(PATTERNS) as (keyof typeof PATTERNS)[]) {
    out = out.replace(new RegExp(PATTERNS[key].source, "g"), REPLACEMENTS[key]);
  }
  return out;
}

/** Field names that must never reach the LLM, whatever their value. */
export const FORBIDDEN_KEYS = new Set([
  "email",
  "publicKey",
  "contractAddress",
  "tokenContractId",
  "vaultContractId",
  "fundWalletPublicKey",
  "shareHolder",
  "wallets",
  "wallet",
  "owner",
  "cnpj",
  "administratorCnpj",
  "managerCnpj",
  "document",
  "consultor",
  "investor",
  "password",
  "token",
  "secret",
  "authorization",
]);

/** Deep copy with forbidden keys dropped and every string scrubbed. */
export function minimize<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map(walk);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(k)) continue;
      out[k] = walk(v);
    }
    return out;
  }
  return value;
}

export interface PayloadFinding {
  pattern: keyof typeof PATTERNS | "forbiddenSecret";
  sample: string;
}

/**
 * Scans a JSON serialisable payload for anything that must not reach the LLM.
 * Thinking signatures are opaque provider data and are skipped. Extra literal
 * secrets (for example the agent token of the request) can be passed in.
 */
export function findLeaks(payload: unknown, extraSecrets: string[] = []): PayloadFinding[] {
  const findings: PayloadFinding[] = [];
  const json = JSON.stringify(payload, (key, v) => (key === "signature" || key === "data" ? undefined : v));
  for (const key of Object.keys(PATTERNS) as (keyof typeof PATTERNS)[]) {
    const m = json.match(new RegExp(PATTERNS[key].source, "g"));
    if (m) for (const s of m) findings.push({ pattern: key, sample: redactSample(s) });
  }
  for (const secret of extraSecrets) {
    if (secret && json.includes(secret)) findings.push({ pattern: "forbiddenSecret", sample: redactSample(secret) });
  }
  return findings;
}

export class PayloadLeakError extends Error {
  constructor(readonly findings: PayloadFinding[]) {
    super(`refusing to send the request to the language model: ${findings.map((f) => f.pattern).join(", ")}`);
    this.name = "PayloadLeakError";
  }
}

export function assertLlmPayloadClean(payload: unknown, extraSecrets: string[] = []): void {
  const findings = findLeaks(payload, extraSecrets);
  if (findings.length) throw new PayloadLeakError(findings);
}

function redactSample(s: string): string {
  return s.length <= 6 ? "***" : `${s.slice(0, 3)}...(${s.length} chars)`;
}

/** Marker used for third party text (fund, assignor, account debtor). */
export interface UntrustedText {
  untrusted: true;
  source: string;
  text: string;
}

/** Wraps third party text as data. Returns null for empty input. */
export function untrusted(source: string, text: string | null | undefined, maxLen = 1200): UntrustedText | null {
  if (text == null) return null;
  const trimmed = String(text).trim();
  if (!trimmed) return null;
  return { untrusted: true, source, text: scrubText(trimmed).slice(0, maxLen) };
}

/** True if a value contains at least one untrusted block. */
export function containsUntrusted(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsUntrusted);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.untrusted === true && typeof obj.text === "string") return true;
    return Object.values(obj).some(containsUntrusted);
  }
  return false;
}
