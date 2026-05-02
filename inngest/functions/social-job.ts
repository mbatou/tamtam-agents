/**
 * Inngest function: runs the Social agent (Awa).
 *
 * Triggered by:
 *   - tamtam/social.mentioned    — Slack @-mention of @Awa
 *   - tamtam/social.run          — manual trigger from /api/agents/social
 *
 * Behaviour:
 *   1. Human "thinking" delay (2–15 min via step.sleep) so the
 *      reply doesn't land instantly. Mention/manual triggers only;
 *      cron triggers bypass since cron is already its own schedule.
 *   2. Run the agent.
 *
 * (Working-hours gate removed in the Session 5 pruning — Augusta's
 * anglophone team works across timezones and the gate produced
 * confusing OOO replies during normal conversation hours.)
 */

import { inngest } from "@/lib/inngest";
import { runSocialAgent } from "@/agents/social";
import {
  delayToInngest,
  getResponseDelay,
} from "@/lib/human-behavior";

export const socialJob = inngest.createFunction(
  { id: "social-job", name: "Awa — Social Agent run" },
  [
    { event: "tamtam/social.mentioned" },
    { event: "tamtam/social.run" },
  ],
  async ({ event, step }) => {
    const isMention = event.name === "tamtam/social.mentioned";
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
          brief?: string;
        })
      : null;

    const triggerSource: "manual" | "cron" | "approval" = runData?.trigger ?? "manual";
    const shouldDelay = triggerSource !== "cron";

    if (shouldDelay) {
      const delayMs = getResponseDelay("social");
      await step.sleep("human-delay", delayToInngest(delayMs));
    }

    return step.run("run-awa", async () => {
      if (mentionData) {
        return runSocialAgent({
          trigger: "manual",
          brief: mentionData.text,
          slackContext: {
            channel: mentionData.channel,
            user: mentionData.user,
            thread_ts: mentionData.thread_ts,
          },
        });
      }
      return runSocialAgent({
        trigger: runData!.trigger,
        brief: runData!.brief,
      });
    });
  },
);
