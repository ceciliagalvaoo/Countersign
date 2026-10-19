// Single place that builds the Anthropic client and the request shape shared by
// every call of the agent. Facts from the claude-api skill (loaded 2026-10-18):
// - claude-opus-5-5: thinking is always on; { type: "disabled" } is a 400.
//   Depth and latency are controlled with output_config.effort.
// - Forced tool_choice ("any" or "tool") is a 400 on this model: use "auto",
//   strict: true on every tool and steer from the prompt.
// - No assistant prefill (400).
// - Server side refusal fallback: fallbacks: "default" with the beta header
//   server-side-fallback-2026-07-01 (the array form uses a different header).
import Anthropic from "@anthropic-ai/sdk";
import { config, hasAnthropicKey, type Effort } from "../config.js";

export const FALLBACK_BETA = "server-side-fallback-2026-07-01" as const;

let client: Anthropic | undefined;

export function getAnthropic(): Anthropic {
  if (!hasAnthropicKey()) {
    throw new Error("ANTHROPIC_API_KEY is not set in the agent environment");
  }
  // The SDK reads ANTHROPIC_API_KEY from the environment; the key is never
  // passed around, logged or sent to the browser.
  client ??= new Anthropic({ maxRetries: 4, timeout: 90_000 });
  return client;
}

export interface BaseRequestOptions {
  model?: string;
  effort?: Effort;
  maxTokens?: number;
  withFallback?: boolean;
}

/** Fields every agent request carries, before system, tools and messages. */
export function baseRequest(opts: BaseRequestOptions = {}) {
  const withFallback = opts.withFallback ?? true;
  return {
    model: opts.model ?? config.model,
    max_tokens: opts.maxTokens ?? 16_000,
    output_config: { effort: opts.effort ?? config.effort },
    ...(withFallback
      ? { betas: [FALLBACK_BETA], fallbacks: "default" as const }
      : {}),
  };
}
