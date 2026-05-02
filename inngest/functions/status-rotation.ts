/**
 * Inngest function: rotate each agent's Slack profile status.
 *
 * Cron: every 30 minutes on weekdays. Each tick reads the current
 * UTC hour, looks up the right status slot per agent in
 * STATUS_SCHEDULE, and calls users.profile.set on that agent's
 * dedicated Slack client.
 *
 * Requires the `users.profile:write` scope on each Slack app.
 * Without it, setAgentStatus throws — we catch per-agent so a
 * scope misconfig on one app doesn't block the others.
 */

import { inngest } from "@/lib/inngest";
import {
  currentStatusFor,
  STATUS_CYCLE,
} from "@/lib/human-behavior";
import { logAgentAction } from "@/lib/supabase";
import { setAgentStatus } from "@/lib/slack";
import type { AgentName } from "@/types";

const AGENTS: ReadonlyArray<AgentName> = ["social", "growth", "coo"];

export const statusRotation = inngest.createFunction(
  {
    id: "status-rotation",
    name: "Rotate Awa/Kofi/Rama Slack statuses",
  },
  [
    { cron: "*/30 * * * 1-5" }, // every 30 min, Mon–Fri (UTC)
    { event: "tamtam/status.rotate" },
  ],
  async ({ step }) => {
    return step.run("rotate", async () => {
      const results: Record<string, { ok: boolean; reason?: string }> = {};

      for (const agent of AGENTS) {
        const slot = currentStatusFor(agent);
        try {
          await setAgentStatus({
            agent,
            statusText: slot.text,
            statusEmoji: slot.emoji,
          });
          await logAgentAction({
            agent,
            action: "status.rotated",
            metadata: {
              text: slot.text,
              emoji: slot.emoji,
            },
            status: "completed",
          });
          results[agent] = { ok: true };
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          await logAgentAction({
            agent,
            action: "status.rotated.failed",
            metadata: { error: reason, slot },
            status: "failed",
          });
          results[agent] = { ok: false, reason };
        }
      }

      // Surface cycle sizes in the run metadata for debugging.
      return {
        results,
        cycle_size: {
          social: STATUS_CYCLE.social.length,
          growth: STATUS_CYCLE.growth.length,
          coo: STATUS_CYCLE.coo.length,
        },
      };
    });
  },
);
