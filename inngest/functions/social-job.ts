/**
 * Inngest function: runs the Social agent (Awa).
 *
 * Triggered by:
 *   - tamtam/social.mentioned    — Slack @-mention of @Awa
 *   - tamtam/social.run          — manual trigger from /api/agents/social
 *
 * Behaviour:
 *   1. Working-hours gate. Outside hours → post a human OOO line and
 *      stop. (Cron-driven runs bypass — the cron sets its own timing.)
 *   2. Response delay. step.sleep for getResponseDelay("social") so the
 *      reply doesn't land instantly.
 *   3. Run the agent, log, return.
 */

import { inngest } from "@/lib/inngest";
import { runSocialAgent } from "@/agents/social";
import { respondWithTyping } from "@/lib/slack";
import {
  delayToInngest,
  getOutOfHoursMessage,
  getResponseDelay,
  isWithinWorkingHours,
} from "@/lib/human-behavior";
import { logAgentAction } from "@/lib/supabase";

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

    // Cron-triggered runs bypass the working-hours gate (Awa's cron
    // schedule is the schedule). Mentions and manual triggers gate.
    const triggerSource: "manual" | "cron" | "approval" = runData?.trigger ?? "manual";
    const shouldGate = triggerSource !== "cron";

    if (shouldGate && !isWithinWorkingHours("social")) {
      // Out-of-hours: post a human auto-reply and stop. Only when we
      // know which channel to post in (mention path always provides it).
      if (mentionData) {
        await step.run("ooo-reply", async () => {
          await respondWithTyping({
            agent: "social",
            channel: mentionData.channel,
            threadTs: mentionData.thread_ts,
            text: getOutOfHoursMessage("social"),
          });
          await logAgentAction({
            agent: "social",
            action: "run.skipped.out_of_hours",
            metadata: { channel: mentionData.channel, user: mentionData.user },
            status: "skipped",
          });
        });
      } else {
        await step.run("log-ooo-skip", async () =>
          logAgentAction({
            agent: "social",
            action: "run.skipped.out_of_hours",
            metadata: { trigger: triggerSource },
            status: "skipped",
          }),
        );
      }
      return { skipped: "outside_working_hours" };
    }

    // Human "thinking" delay before the actual reply.
    if (shouldGate) {
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
