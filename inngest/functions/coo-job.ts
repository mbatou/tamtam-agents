/**
 * Inngest function: runs the COO agent on a 4-hour schedule (8am, 12pm, 4pm
 * Dakar time = UTC+0). Inngest crons are UTC; Dakar offset is 0, so the
 * crontab below is already correct.
 *
 * Also responds to:
 *   - tamtam/coo.tick       — manual on-demand brief
 *   - tamtam/coo.mentioned  — @tamtam-coo in Slack
 */

import { inngest } from "@/lib/inngest";
import { runCooAgent } from "@/agents/coo";

export const cooJob = inngest.createFunction(
  { id: "coo-job", name: "Tamtam COO tick" },
  [
    { cron: "0 8,12,16 * * *" },
    { event: "tamtam/coo.tick" },
    { event: "tamtam/coo.mentioned" },
  ],
  async ({ event, step }) => {
    const trigger: "cron" | "manual" =
      event && "name" in event && event.name === "tamtam/coo.tick"
        ? event.data.trigger
        : event && "name" in event && event.name === "tamtam/coo.mentioned"
          ? "manual"
          : "cron";

    return step.run("run-coo-agent", async () => runCooAgent({ trigger }));
  },
);
