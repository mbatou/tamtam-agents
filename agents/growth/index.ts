/**
 * Growth agent entrypoint.
 */

import { runWithTools } from "@/lib/anthropic";
import { logAgentAction } from "@/lib/supabase";
import { GROWTH_SYSTEM_PROMPT } from "./system-prompt";
import { growthTools, type SlackContext } from "./tools";

export interface RunGrowthAgentInput {
  trigger: "manual" | "cron" | "approval";
  brief?: string;
  lead_id?: string;
  slackContext?: SlackContext;
}

export interface RunGrowthAgentResult {
  text: string;
  iterations: number;
  toolCallCount: number;
}

export async function runGrowthAgent(
  input: RunGrowthAgentInput,
): Promise<RunGrowthAgentResult> {
  await logAgentAction({
    agent: "growth",
    action: "run.started",
    metadata: {
      trigger: input.trigger,
      lead_id: input.lead_id ?? null,
      slack: input.slackContext ?? null,
    },
    status: "started",
  });

  try {
    const userPrompt =
      input.brief?.trim() ??
      (input.lead_id
        ? `Continue working lead_id=${input.lead_id}. ` +
          `If a draft is appropriate, prepare an outreach email and request approval.`
        : "Find one new high-fit lead, research the right contact, and draft an outreach.");

    const result = await runWithTools({
      system: GROWTH_SYSTEM_PROMPT,
      user: userPrompt,
      tools: growthTools({ slack: input.slackContext }),
    });

    await logAgentAction({
      agent: "growth",
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
      agent: "growth",
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
