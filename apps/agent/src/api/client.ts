// HTTP client for the Countersign API (apps/api). Every request carries the
// agent scope token of the investor, as received in POST /chat. The token is
// held only in memory for the duration of the request: it is never logged,
// never written to the session dump and never sent to the language model.
import { scrubText } from "../safety/minimize.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** Short, scrubbed message safe for the LLM and the log. */
    readonly safeMessage: string,
    /** Parsed error body, scrubbed, for rules returned with 4xx (for example 409 with a rule). */
    readonly body: Record<string, unknown> | null,
  ) {
    super(`API ${status}: ${safeMessage}`);
    this.name = "ApiError";
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  agentToken: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.opts.agentToken}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      const reason = (err as Error).name === "AbortError" ? "timed out" : "unreachable";
      throw new ApiError(0, `the Countersign API is ${reason}`, null);
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (!res.ok) {
      const obj = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
      const message = typeof obj?.error === "string" ? obj.error : `request failed`;
      throw new ApiError(res.status, scrubText(message).slice(0, 300), obj);
    }
    return parsed as T;
  }
}
