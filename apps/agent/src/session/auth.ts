// Agent scope token handling. apps/agent has no JWT secret: the API verifies
// the token on every call. Here we only (1) refuse anything that is not an
// agent scope token (a full investor token must never be accepted, it could
// approve a mandate), (2) bind each session to one user, and (3) confirm a new
// token with the API once before trusting its user id claim.
import { ApiClient, ApiError, type FetchLike } from "../api/client.js";

export class AuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface TokenClaims {
  userId: string;
  scope: "agent";
  exp: number | null;
}

/** Reads (does not verify) the JWT payload. Only id, scope and exp are kept. */
export function readAgentClaims(authorization: string | undefined): { token: string; claims: TokenClaims } {
  if (!authorization?.startsWith("Bearer ")) throw new AuthError(401, "Send the agent scope token in the Authorization header.");
  const token = authorization.slice("Bearer ".length).trim();
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError(401, "Invalid agent token.");
  let payload: { id?: unknown; scope?: unknown; exp?: unknown };
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new AuthError(401, "Invalid agent token.");
  }
  if (payload.scope !== "agent") {
    throw new AuthError(401, "Only an agent scope token is accepted here (POST /api/agent/session-token).");
  }
  if (typeof payload.id !== "string" || !payload.id) throw new AuthError(401, "Invalid agent token.");
  const exp = typeof payload.exp === "number" ? payload.exp : null;
  if (exp !== null && exp * 1000 < Date.now()) throw new AuthError(401, "The agent token expired; request a new one.");
  return { token, claims: { userId: payload.id, scope: "agent", exp } };
}

/** Confirms with the API that the token is valid (cheapest route the agent scope allows). */
export async function confirmTokenWithApi(baseUrl: string, token: string, fetchImpl?: FetchLike): Promise<void> {
  const api = new ApiClient({ baseUrl, agentToken: token, fetch: fetchImpl, timeoutMs: 10_000 });
  try {
    await api.get("/mandates/draft");
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      throw new AuthError(401, "The API did not accept this agent token.");
    }
    throw err;
  }
}
