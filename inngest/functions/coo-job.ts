/**
 * Inngest function: runs the COO agent on a 4-hour schedule (8am, 12pm, 4pm
 * Dakar time = UTC+0). Inngest cron is in UTC; Dakar offset is 0, so the
 * crontab below is already correct.
 *
 * Also responds to `agents/coo.tick` for manual on-demand briefs.
 */

import { inngest } from "@/lib/inngest";
import { runCooAgent } from "@/agents/coo";

export const cooJob = inngest.createFunction(
  { id: "coo-job", name: "Tamtam COO tick" },
  [
    { cron: "TZ=UTC 0 8,12,16 * * *" },
    { event: "agents/coo.tick" },
  ],
  async ({ event, step }) => {
    const trigger = event?.name === "agents/coo.tick"
      ? event.data.trigger
      : "cron";
    return step.run("run-coo-agent", async () => runCooAgent({ trigger }));
  },
);
