/**
 * Growth agent entrypoint. See agents/social/index.ts for the pattern.
 */

import { runWithTools } from "@/lib/anthropic";
import { logAgentAction } from "@/lib/supabase";
import { GROWTH_SYSTEM_PROMPT } from "./system-prompt";
import { growthTools } from "./tools";

export interface RunGrowthAgentInput {
  trigger: "manual" | "cron" | "approval";
  lead_id?: string;
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
    metadata: { trigger: input.trigger, lead_id: input.lead_id ?? null },
    status: "started",
  });

  try {
    const userPrompt = input.lead_id
      ? `Continue working lead_id=${input.lead_id}. ` +
        `If a draft is appropriate, prepare an outreach email and request approval.`
      : "Find one new high-fit lead, research the right contact, and draft an outreach.";

    const result = await runWithTools({
      system: GROWTH_SYSTEM_PROMPT,
      user: userPrompt,
      tools: growthTools(),
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
