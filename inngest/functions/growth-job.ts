/**
 * Inngest function: runs the Growth agent (Kofi).
 *
 * Triggered by:
 *   - tamtam/growth.mentioned    — Slack @-mention of @Kofi
 *   - tamtam/growth.run          — manual trigger from /api/agents/growth
 *
 * Human "thinking" delay (2–8 min) on mention/manual; cron bypasses.
 * Working-hours gate removed in Session 5.
 */

import { inngest } from "@/lib/inngest";
import { runGrowthAgent } from "@/agents/growth";
import {
  delayToInngest,
  getResponseDelay,
} from "@/lib/human-behavior";

export const growthJob = inngest.createFunction(
  { id: "growth-job", name: "Kofi — Growth Agent run" },
  [
    { event: "tamtam/growth.mentioned" },
    { event: "tamtam/growth.run" },
  ],
  async ({ event, step }) => {
    const isMention = event.name === "tamtam/growth.mentioned";
    const mentionData = isMention
      ? (event.data as {
          text: string;
          channel: string;
          user: string;
          thread_ts?: string;
          event_ts: string;
        })
      : null;
    const runData = !isMention
      ? (event.data as {
          trigger: "manual" | "cron" | "approval";
          lead_id?: string;
        })
      : null;

    const triggerSource: "manual" | "cron" | "approval" = runData?.trigger ?? "manual";
    const shouldDelay = triggerSource !== "cron";

    if (shouldDelay) {
      const delayMs = getResponseDelay("growth");
      await step.sleep("human-delay", delayToInngest(delayMs));
    }

    return step.run("run-kofi", async () => {
      if (mentionData) {
        return runGrowthAgent({
          trigger: "manual",
          brief: mentionData.text,
          slackContext: {
            channel: mentionData.channel,
            user: mentionData.user,
            thread_ts: mentionData.thread_ts,
          },
        });
      }
      return runGrowthAgent({
        trigger: runData!.trigger,
        lead_id: runData!.lead_id,
      });
    });
  },
);
