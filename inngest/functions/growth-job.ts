/**
 * Inngest function: runs the Growth agent (Kofi).
 *
 * Triggered by:
 *   - tamtam/growth.mentioned    — Slack @-mention of @Kofi
 *   - tamtam/growth.run          — manual trigger from /api/agents/growth
 *
 * Working-hours gate + human response delay applied to mention/manual
 * triggers; cron triggers bypass.
 */

import { inngest } from "@/lib/inngest";
import { runGrowthAgent } from "@/agents/growth";
import { respondWithTyping } from "@/lib/slack";
import {
  delayToInngest,
  getOutOfHoursMessage,
  getResponseDelay,
  isWithinWorkingHours,
} from "@/lib/human-behavior";
import { logAgentAction } from "@/lib/supabase";

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
    const shouldGate = triggerSource !== "cron";

    if (shouldGate && !isWithinWorkingHours("growth")) {
      if (mentionData) {
        await step.run("ooo-reply", async () => {
          await respondWithTyping({
            agent: "growth",
            channel: mentionData.channel,
            threadTs: mentionData.thread_ts,
            text: getOutOfHoursMessage("growth"),
          });
          await logAgentAction({
            agent: "growth",
            action: "run.skipped.out_of_hours",
            metadata: { channel: mentionData.channel, user: mentionData.user },
            status: "skipped",
          });
        });
      } else {
        await step.run("log-ooo-skip", async () =>
          logAgentAction({
            agent: "growth",
            action: "run.skipped.out_of_hours",
            metadata: { trigger: triggerSource },
            status: "skipped",
          }),
        );
      }
      return { skipped: "outside_working_hours" };
    }

    if (shouldGate) {
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
