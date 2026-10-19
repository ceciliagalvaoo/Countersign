// Shape of an agent tool. Every tool is declared with strict: true and a JSON
// schema that sets additionalProperties: false and lists every property in
// required, so the arguments Claude sends always match the schema. The zod
// schema re validates on our side before anything runs (defence in depth).
import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type { ApiClient } from "../api/client.js";
import type { MandateView } from "./projections.js";

export interface JsonObjectSchema {
  [key: string]: unknown;
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
}

export interface AgentTool<I = unknown, O = unknown> {
  name: string;
  description: string;
  inputSchema: JsonObjectSchema;
  input: z.ZodType<I>;
  run: (input: I, ctx: ToolContext) => Promise<O>;
}

export interface ToolContext {
  sessionId: string;
  /** API client bound to the agent scope token. The token itself is not exposed to tools. */
  api: ApiClient;
  /** Id of the tool_use block being executed (sent as toolCallId in proposals). */
  toolUseId: string;
  /** Last mandate view known to the session (for quotes), or null. */
  mandate: MandateView | null;
  /** Policy decisions made in this session (only these can be executed by the agent). */
  decisions: SessionDecision[];
  /** True while the investor has interrupted the session: no execution starts. */
  executionPaused: boolean;
  /** The investor's own messages in this session (scrubbed), to verify amountSource "investor_message". */
  investorMessages: string[];
  /** "chat" for proposals from the conversation, "recurring" for the pre authorised recurring trigger. */
  origin: "chat" | "recurring";
}

/** A policy decision returned to this session by propose_subscription. */
export interface SessionDecision {
  seq: number;
  fundId: string;
  amountUsdc: string;
  outcome: "APPROVED" | "REJECTED" | "NEEDS_INVESTOR_SIGNATURE";
  rule: string;
  at: string;
  /** Hash of the decision log row (64 hex); the API stores it on the order as decisionHash. */
  hash?: string | null;
  origin?: "chat" | "recurring";
  /** Execution result as reported by the API, once execute_approved_purchase ran. */
  execution?: "confirmed_on_chain" | "pending_network" | "refused" | "expired" | "already_executed";
}

/** Error raised by a tool. The message is shown to the LLM as an is_error tool_result. */
export class ToolError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

export interface ToolCallLog {
  id: string;
  turn: number;
  tool: string;
  input: unknown;
  /** Exactly what the LLM received (already minimised). */
  output: unknown;
  isError: boolean;
  durationMs: number;
  at: string;
}

/** Throws if a schema would not be accepted as a strict tool schema. */
export function assertStrictSchema(name: string, schema: JsonObjectSchema): void {
  if (schema.additionalProperties !== false) {
    throw new Error(`tool ${name}: additionalProperties must be false`);
  }
  const props = Object.keys(schema.properties).sort();
  const req = [...schema.required].sort();
  if (props.join(",") !== req.join(",")) {
    throw new Error(`tool ${name}: every property must be listed in required`);
  }
}

/** Tool definition as sent to the Messages API. Order is deterministic (cache). */
export function toApiTool(tool: AgentTool<any, any>): Anthropic.Beta.Messages.BetaTool {
  assertStrictSchema(tool.name, tool.inputSchema);
  return {
    name: tool.name,
    description: tool.description,
    strict: true,
    input_schema: tool.inputSchema,
  };
}
