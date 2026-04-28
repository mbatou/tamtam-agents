/**
 * COO agent entrypoint. Triggered by cron or manual invocation.
 */

import { runWithTools } from "@/lib/anthropic";
import { logAgentAction } from "@/lib/supabase";
import { COO_SYSTEM_PROMPT } from "./system-prompt";
import { cooTools } from "./tools";

export interface RunCooAgentInput {
  trigger: "cron" | "manual";
}

export interface RunCooAgentResult {
  text: string;
  iterations: number;
  toolCallCount: number;
}

export async function runCooAgent(
  input: RunCooAgentInput,
): Promise<RunCooAgentResult> {
  await logAgentAction({
    agent: "coo",
    action: "tick.started",
    metadata: { trigger: input.trigger },
    status: "started",
  });

  try {
    const result = await runWithTools({
      system: COO_SYSTEM_PROMPT,
      user:
        "Run a tick. Fetch recent activity, decide whether anything is " +
        "stalled, post the brief, and only ping Georges if a decision is needed.",
      tools: cooTools(),
    });

    await logAgentAction({
      agent: "coo",
      action: "tick.completed",
      metadata: {
        trigger: input.trigger,
        iterations: result.iterations,
        toolCalls: result.toolCalls.map((t) => t.name),
      },
      status: "completed",
    });

    return {
      text: result.finalText,
      iterations: result.iterations,
      toolCallCount: result.toolCalls.length,
    };
  } catch (err) {
    await logAgentAction({
      agent: "coo",
      action: "tick.failed",
      metadata: {
        trigger: input.trigger,
        error: err instanceof Error ? err.message : String(err),
      },
      status: "failed",
    });
    throw err;
  }
}
