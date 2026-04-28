/**
 * Inngest function: runs the Growth agent.
 *
 * Triggered by:
 *   - tamtam/growth.mentioned    — Slack @-mention of @tamtam-growth
 *   - tamtam/growth.run          — manual trigger from /api/agents/growth
 */

import { inngest } from "@/lib/inngest";
import { runGrowthAgent } from "@/agents/growth";

export const growthJob = inngest.createFunction(
  { id: "growth-job", name: "Tamtam Growth Agent run" },
  [
    { event: "tamtam/growth.mentioned" },
    { event: "tamtam/growth.run" },
  ],
  async ({ event, step }) => {
    return step.run("run-growth-agent", async () => {
      if (event.name === "tamtam/growth.mentioned") {
        const data = event.data as {
          text: string;
          channel: string;
          user: string;
          thread_ts?: string;
          event_ts: string;
        };
        return runGrowthAgent({
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
        lead_id?: string;
      };
      return runGrowthAgent({
        trigger: data.trigger,
        lead_id: data.lead_id,
      });
    });
  },
);
