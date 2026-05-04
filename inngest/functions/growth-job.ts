/**
 * Inngest function: runs the Growth agent (Kofi).
 *
 * Triggered by:
 *   - tamtam/growth.mentioned    — Slack @-mention of @Kofi
 *   - tamtam/growth.run          — manual trigger from /api/agents/growth
 *
 * Human "thinking" delay (2–8 min) on mention/manual — EXCEPT when
 * the message text is a direct admin command from Georges. Admin
 * commands skip the delay entirely so Kofi acknowledges within
 * seconds (DB write + Slack ack happen inside the tool handlers).
 *
 * Cron triggers also bypass. Working-hours gate removed in Session 5.
 */

import { inngest } from "@/lib/inngest";
import { runGrowthAgent } from "@/agents/growth";
import {
  delayToInngest,
  getResponseDelay,
} from "@/lib/human-behavior";

/**
 * Heuristic: does this Slack message read like Georges giving Kofi
 * a direct admin instruction (status update, lead add, pipeline
 * query) rather than a real conversation? When true we skip the
 * "human thinking" delay so the ack lands in seconds.
 *
 * Conservative on purpose — false negatives (admin command
 * mistakenly delayed) are mildly annoying. False positives
 * (real conversation answered too fast) break the human feel
 * worse. The patterns below only match clear command shapes.
 */
function isAdminCommand(text: string): boolean {
  const adminPatterns: ReadonlyArray<RegExp> = [
    /\bmark\b.*\bas\b/i,
    /\badd\b.*\blead\b/i,
    /\bpause\b/i,
    /\bresume\b/i,
    /\bpipeline\s+status\b/i,
    /\bwhat['']?s?\s+(?:the\s+)?(?:status|pipeline)\b/i,
    /\b(?:they|he|she)['']?(?:re|s)?\s+(?:not\s+)?interested\b/i,
    /\breplied\b/i,
    /\bnot\s+interested\b/i,
    /\barchive\b/i,
    /\bremove\b/i,
    /\bdelete\b/i,
  ];
  return adminPatterns.some((p) => p.test(text));
}

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

    const triggerSource: "manual" | "cron" | "approval" =
      runData?.trigger ?? "manual";

    // Three reasons to skip the delay:
    //   1. Cron triggers (already cron-paced).
    //   2. Admin commands in a mention (Georges expects fast acks).
    const isAdmin =
      mentionData != null && isAdminCommand(mentionData.text);
    const shouldDelay = triggerSource !== "cron" && !isAdmin;

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
