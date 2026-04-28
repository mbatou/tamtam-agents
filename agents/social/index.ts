/**
 * Social agent entrypoint.
 *
 * Called by the Inngest `socialJob` function. Responsible for:
 *   - logging "started" to agent_logs
 *   - running Claude with the Social tools loop
 *   - logging "completed" / "failed" with token usage and tool trace
 */

import { runWithTools } from "@/lib/anthropic";
import { logAgentAction } from "@/lib/supabase";
import { SOCIAL_SYSTEM_PROMPT } from "./system-prompt";
import { socialTools } from "./tools";

export interface RunSocialAgentInput {
  trigger: "manual" | "cron" | "approval";
  brief?: string;
}

export interface RunSocialAgentResult {
  text: string;
  iterations: number;
  toolCallCount: number;
}

export async function runSocialAgent(
  input: RunSocialAgentInput,
): Promise<RunSocialAgentResult> {
  await logAgentAction({
    agent: "social",
    action: "run.started",
    metadata: { trigger: input.trigger, brief: input.brief ?? null },
    status: "started",
  });

  try {
    const userPrompt =
      input.brief?.trim() ??
      "Draft today's LinkedIn post for Tamtam. Pick an angle that " +
        "highlights why WhatsApp Status outperforms Instagram for " +
        "reaching West-African audiences.";

    const result = await runWithTools({
      system: SOCIAL_SYSTEM_PROMPT,
      user: userPrompt,
      tools: socialTools(),
    });

    await logAgentAction({
      agent: "social",
      action: "run.completed",
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
      agent: "social",
      action: "run.failed",
      metadata: {
        trigger: input.trigger,
        error: err instanceof Error ? err.message : String(err),
      },
      status: "failed",
    });
    throw err;
  }
}
