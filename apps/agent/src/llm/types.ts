// The one seam between the agent and the language model provider. The agent
// loop only knows this interface, so tests inject a scripted client and record
// every request exactly as it would have been sent to Anthropic.
import type Anthropic from "@anthropic-ai/sdk";

export type LlmRequest = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
export type LlmResponse = Anthropic.Beta.Messages.BetaMessage;
export type LlmMessage = Anthropic.Beta.Messages.BetaMessageParam;
export type LlmToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam;

export interface LlmClient {
  /** "anthropic" for the real provider, "scripted" for tests and offline demos. */
  readonly kind: "anthropic" | "scripted";
  create(request: LlmRequest): Promise<LlmResponse>;
}

/** Error from the provider, reduced to what is safe to show and log. */
export class LlmUnavailableError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "LlmUnavailableError";
  }
}
