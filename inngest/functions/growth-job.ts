/**
 * Inngest function: runs the Growth agent.
 */

import { inngest } from "@/lib/inngest";
import { runGrowthAgent } from "@/agents/growth";

export const growthJob = inngest.createFunction(
  { id: "growth-job", name: "Tamtam Growth Agent run" },
  { event: "agents/growth.run" },
  async ({ event, step }) => {
    return step.run("run-growth-agent", async () =>
      runGrowthAgent({
        trigger: event.data.trigger,
        lead_id: event.data.lead_id,
      }),
    );
  },
);
