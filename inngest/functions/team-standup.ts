/**
 * Inngest function: Rama's morning standup.
 *
 * Cron: 08:00 UTC, Mon–Fri (08:00 WAT, since Dakar is UTC+0 year-round).
 *
 * Reads the last 24h of agent_logs, asks Rama (COO persona) to compose
 * a short morning check-in, posts it to #tamtam-team. Skips cleanly if
 * SLACK_CHANNEL_TEAM is not configured.
 *
 * Also responds to `tamtam/team.standup` events for manual triggers.
 */

import { inngest } from "@/lib/inngest";
import { getRecentAgentLogs, logAgentAction } from "@/lib/supabase";
import { speakAs } from "@/lib/team-voice";

export const teamStandup = inngest.createFunction(
  { id: "team-standup", name: "Rama — morning standup in #tamtam-team" },
  [
    // Mon-Fri at 08:00 UTC. Inngest cron is 5-field minute-first.
    { cron: "0 8 * * 1-5" },
    { event: "tamtam/team.standup" },
  ],
  async ({ step }) => {
    return step.run("post-standup", async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [socialLogs, growthLogs, cooLogs] = await Promise.all([
        getRecentAgentLogs("social", since),
        getRecentAgentLogs("growth", since),
        getRecentAgentLogs("coo", since),
      ]);

      const summarise = (label: string, rows: typeof socialLogs): string => {
        if (rows.length === 0) return `${label}: idle`;
        const completed = rows.filter((r) => r.status === "completed");
        const failed = rows.filter((r) => r.status === "failed");
        const recent = completed
          .slice(0, 5)
          .map((r) => `  - ${r.action}`)
          .join("\n");
        return (
          `${label}: ${completed.length} completed, ${failed.length} failed\n` +
          (recent ? `  recent:\n${recent}` : "")
        );
      };

      const brief =
        `It is Monday-to-Friday morning. Compose a short, warm team ` +
        `standup for #tamtam-team. Acknowledge what happened ` +
        `yesterday, set the tone for today, name Awa and Kofi with ` +
        `their priorities. Keep it under 6 lines. Use 1–2 emojis at ` +
        `most. Do not list logs as bullet points — speak like a ` +
        `human leader who read them.\n\n` +
        `Yesterday's activity:\n` +
        summarise("Awa (Social)", socialLogs) +
        "\n" +
        summarise("Kofi (Growth)", growthLogs) +
        "\n" +
        summarise("Rama (COO)", cooLogs);

      const res = await speakAs({
        agent: "coo",
        brief,
        source: "standup",
        maxTokens: 400,
      });

      if (!res.posted) {
        await logAgentAction({
          agent: "coo",
          action: "team.standup.skipped",
          metadata: { reason: res.reason },
          status: "skipped",
        });
      }
      return res;
    });
  },
);
