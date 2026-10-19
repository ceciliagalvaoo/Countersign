// Real provider: the official Anthropic SDK, beta Messages API (needed for the
// server side refusal fallback header). The key is read by the SDK from the
// environment and never passes through this module.
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "./client.js";
import { LlmUnavailableError, type LlmClient, type LlmRequest, type LlmResponse } from "./types.js";

export class AnthropicLlmClient implements LlmClient {
  readonly kind = "anthropic" as const;

  async create(request: LlmRequest): Promise<LlmResponse> {
    try {
      return await getAnthropic().beta.messages.create(request);
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        const body = err.error as { error?: { message?: string } } | undefined;
        const detail = body?.error?.message ?? err.message;
        throw new LlmUnavailableError(`provider error ${err.status ?? "unknown"}: ${detail}`, err.status ?? null);
      }
      if (err instanceof Error && err.message.includes("ANTHROPIC_API_KEY")) {
        throw new LlmUnavailableError("the language model key is not configured", null);
      }
      throw err;
    }
  }
}
