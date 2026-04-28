/**
 * Anthropic Claude API wrapper.
 *
 * Thin opinionated layer on top of @anthropic-ai/sdk. Centralises:
 *   - the default model (overridable via env)
 *   - prompt-caching defaults
 *   - retry/error context
 *   - typed helpers for the two patterns we actually use:
 *       1. `generateText` — single completion with system + messages
 *       2. `runWithTools` — tool-using loop, invoked by agents in /agents/*
 */

import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

let clientSingleton: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (clientSingleton) return clientSingleton;
  clientSingleton = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return clientSingleton;
}

/* -------------------------------------------------------------------------- */
/*  Plain text generation                                                     */
/* -------------------------------------------------------------------------- */

export interface GenerateTextInput {
  system: string;
  user: string;
  /** Defaults to env.ANTHROPIC_MODEL. */
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** Whether to apply prompt-caching to the system prompt. */
  cacheSystem?: boolean;
}

export interface GenerateTextResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  stopReason: string | null;
}

export async function generateText(
  input: GenerateTextInput,
): Promise<GenerateTextResult> {
  const client = getAnthropic();
  const model = input.model ?? env.ANTHROPIC_MODEL;

  const system = input.cacheSystem
    ? [{ type: "text" as const, text: input.system, cache_control: { type: "ephemeral" as const } }]
    : input.system;

  const res = await client.messages.create({
    model,
    max_tokens: input.maxTokens ?? 1024,
    temperature: input.temperature ?? 0.7,
    system,
    messages: [{ role: "user", content: input.user }],
  });

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  // SDK 0.32 doesn't expose cache_* fields on the typed Usage shape yet,
  // even though the API returns them when prompt-caching is engaged.
  const usage = res.usage as Anthropic.Usage & {
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };

  return {
    text,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    stopReason: res.stop_reason,
  };
}

/* -------------------------------------------------------------------------- */
/*  Tool-using loop                                                           */
/* -------------------------------------------------------------------------- */

export type ToolHandler = (input: unknown) => Promise<unknown>;

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Anthropic.Tool.InputSchema;
  handler: ToolHandler;
}

export interface RunWithToolsInput {
  system: string;
  user: string;
  tools: ToolDefinition[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** Hard cap on tool-use turns to avoid runaway loops. */
  maxIterations?: number;
}

export interface RunWithToolsResult {
  finalText: string;
  iterations: number;
  toolCalls: Array<{ name: string; input: unknown; output: unknown }>;
  stopReason: string | null;
}

export async function runWithTools(
  input: RunWithToolsInput,
): Promise<RunWithToolsResult> {
  const client = getAnthropic();
  const model = input.model ?? env.ANTHROPIC_MODEL;
  const maxIterations = input.maxIterations ?? 8;

  const toolDefs: Anthropic.Tool[] = input.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));

  const handlers = new Map<string, ToolHandler>(
    input.tools.map((t) => [t.name, t.handler] as const),
  );

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: input.user },
  ];
  const toolCalls: Array<{ name: string; input: unknown; output: unknown }> = [];

  let iterations = 0;
  let lastStopReason: string | null = null;

  while (iterations < maxIterations) {
    iterations += 1;

    const res = await client.messages.create({
      model,
      max_tokens: input.maxTokens ?? 2048,
      temperature: input.temperature ?? 0.4,
      system: input.system,
      tools: toolDefs,
      messages,
    });

    lastStopReason = res.stop_reason;
    messages.push({ role: "assistant", content: res.content });

    if (res.stop_reason !== "tool_use") {
      const finalText = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { finalText, iterations, toolCalls, stopReason: lastStopReason };
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      const handler = handlers.get(block.name);
      if (!handler) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          is_error: true,
          content: `No handler registered for tool '${block.name}'.`,
        });
        continue;
      }

      try {
        const output = await handler(block.input);
        toolCalls.push({ name: block.name, input: block.input, output });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(output),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toolCalls.push({
          name: block.name,
          input: block.input,
          output: { error: message },
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          is_error: true,
          content: message,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  throw new Error(
    `[anthropic] runWithTools exceeded maxIterations=${maxIterations}`,
  );
}
