/**
 * Inngest function: runs the Social agent.
 *
 * Triggered by:
 *   - tamtam/social.mentioned    — Slack @-mention of @tamtam-social
 *   - tamtam/social.run          — manual trigger from /api/agents/social
 */

import { inngest } from "@/lib/inngest";
import { runSocialAgent } from "@/agents/social";

export const socialJob = inngest.createFunction(
  { id: "social-job", name: "Tamtam Social Agent run" },
  [
    { event: "tamtam/social.mentioned" },
    { event: "tamtam/social.run" },
  ],
  async ({ event, step }) => {
    return step.run("run-social-agent", async () => {
      if (event.name === "tamtam/social.mentioned") {
        const data = event.data as {
          text: string;
          channel: string;
          user: string;
          thread_ts?: string;
          event_ts: string;
        };
        return runSocialAgent({
          trigger: "manual",
          brief: data.text,
          slackContext: {
            channel: data.channel,
            user: data.user,
            thread_ts: data.thread_ts,
          },
        });
      }
      const data = event.data as {
        trigger: "manual" | "cron" | "approval";
        brief?: string;
      };
      return runSocialAgent({
        trigger: data.trigger,
        brief: data.brief,
      });
    });
  },
);
