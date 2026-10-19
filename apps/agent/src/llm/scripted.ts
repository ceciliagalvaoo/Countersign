// Scripted language model client: returns pre written assistant turns in order
// and records every request it receives (deep copied, exactly what would have
// gone to the provider). Used by the tests and by offline demos. It never
// pretends to be Claude: responses carry model "scripted".
import type { LlmClient, LlmRequest, LlmResponse } from "./types.js";

export interface ScriptedToolUse {
  name: string;
  input: Record<string, unknown>;
  /** Optional fixed id; a deterministic one is generated otherwise. */
  id?: string;
}

export interface ScriptedTurn {
  text?: string;
  toolUses?: ScriptedToolUse[];
  stopReason?: LlmResponse["stop_reason"];
}

/** A step is a fixed turn, or a function of the request it answers. */
export type ScriptStep = ScriptedTurn | ((request: LlmRequest, index: number) => ScriptedTurn);

export class ScriptedLlmClient implements LlmClient {
  readonly kind = "scripted" as const;
  readonly requests: LlmRequest[] = [];
  private cursor = 0;
  private idCounter = 0;

  constructor(private readonly steps: ScriptStep[]) {}

  /** Requests as JSON text, for payload inspection in tests. */
  requestsJson(): string[] {
    return this.requests.map((r) => JSON.stringify(r));
  }

  remaining(): number {
    return this.steps.length - this.cursor;
  }

  async create(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(JSON.parse(JSON.stringify(request)) as LlmRequest);
    const index = this.cursor++;
    const step = this.steps[index];
    if (!step) throw new Error(`scripted client: no step ${index + 1} (script has ${this.steps.length})`);
    const turn = typeof step === "function" ? step(request, index) : step;

    const content: unknown[] = [];
    if (turn.text) content.push({ type: "text", text: turn.text, citations: null });
    for (const t of turn.toolUses ?? []) {
      content.push({
        type: "tool_use",
        id: t.id ?? `toolu_scripted_${++this.idCounter}`,
        name: t.name,
        input: t.input,
      });
    }
    const stopReason = turn.stopReason ?? ((turn.toolUses?.length ?? 0) > 0 ? "tool_use" : "end_turn");
    return {
      id: `msg_scripted_${index + 1}`,
      type: "message",
      role: "assistant",
      model: "scripted",
      content,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    } as unknown as LlmResponse;
  }
}
