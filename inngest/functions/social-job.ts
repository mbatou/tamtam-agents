/**
 * Inngest function: runs the Social agent.
 *
 * Triggered by:
 *   - "agents/social.run" event (manual / Slack mention)
 *   - "approvals/decision" when payload.kind === "linkedin_post"
 *     (handled in a separate function in session 2)
 */

import { inngest } from "@/lib/inngest";
import { runSocialAgent } from "@/agents/social";

export const socialJob = inngest.createFunction(
  { id: "social-job", name: "Tamtam Social Agent run" },
  { event: "agents/social.run" },
  async ({ event, step }) => {
    return step.run("run-social-agent", async () =>
      runSocialAgent({
        trigger: event.data.trigger,
        brief: event.data.brief,
      }),
    );
  },
);
