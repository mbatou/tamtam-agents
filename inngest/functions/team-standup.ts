/**
 * Inngest function: morning standup in #tamtam-team.
 *
 * Cron: 08:00 UTC, Mon–Fri (08:00 WAT — Dakar is UTC+0).
 *
 * Sequence:
 *   1. Pull last 24h of agent_logs
 *   2. Rama posts the standup, referencing actual yesterday activity
 *   3. step.sleep 30s
 *   4. Roll dice — 70% Kofi chimes in with today's plan
 *   5. step.sleep 60s (from Kofi's slot start)
 *   6. Roll dice — 60% Awa adds her focus
 *
 * Cron-driven; bypasses the working-hours gate. Rama owns 08:00.
 */

import { inngest } from "@/lib/inngest";
import { getRecentAgentLogs, logAgentAction } from "@/lib/supabase";
import { speakAs } from "@/lib/team-voice";

const KOFI_PROBABILITY = 0.7;
const AWA_PROBABILITY = 0.6;

export const teamStandup = inngest.createFunction(
  { id: "team-standup", name: "Rama — morning standup in #tamtam-team" },
  [
    { cron: "0 8 * * 1-5" },
    { event: "tamtam/team.standup" },
  ],
  async ({ step }) => {
    const snapshot = await step.run("activity-snapshot", async () => {
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

      return {
        block:
          summarise("Awa (Social)", socialLogs) +
          "\n" +
          summarise("Kofi (Growth)", growthLogs) +
          "\n" +
          summarise("Rama (COO)", cooLogs),
        social_count: socialLogs.length,
        growth_count: growthLogs.length,
      };
    });

    const ramaTurn = await step.run("rama-standup", async () =>
      speakAs({
        agent: "coo",
        brief:
          `It is a weekday morning in Dakar. Compose the team standup ` +
          `for #tamtam-team. Acknowledge what happened yesterday ` +
          `(specific, never generic). Set the tone for today. Name ` +
          `Awa and Kofi with their priorities. If Babacar's SAS or ` +
          `the Tiak-Tiak J+7 / J+15 dates are relevant given the ` +
          `current date, surface them naturally. 6 lines max. ` +
          `1–2 emojis at most. Speak like a leader who read the ` +
          `logs, not a reporter listing them.\n\n` +
          `Yesterday's activity:\n` +
          snapshot.block,
        source: "standup.rama",
        maxTokens: 450,
      }),
    );

    const dice = await step.run("roll-dice", async () => ({
      kofi: Math.random() < KOFI_PROBABILITY,
      awa: Math.random() < AWA_PROBABILITY,
    }));

    if (dice.kofi) {
      await step.sleep("kofi-pause", "30s");
      await step.run("kofi-plan", async () =>
        speakAs({
          agent: "growth",
          brief:
            `Rama just posted the morning standup in #tamtam-team. ` +
            `Add your plan for today — short, in your voice (Kofi). ` +
            `Two lines max. Don't repeat Rama. Mention which leads ` +
            `or pipeline moves you're prioritising. If you're chasing ` +
            `Tiak-Tiak data, Air Sénégal / BAL / Shell follow-up, or ` +
            `Casamançaise — say so. Confidence-energy.\n\n` +
            `What Rama said:\n> ${ramaTurn.text ?? ""}`,
          source: "standup.kofi",
          maxTokens: 200,
        }),
      );
    } else {
      await step.run("kofi-skipped", async () =>
        logAgentAction({
          agent: "growth",
          action: "team.standup.kofi_skipped",
          metadata: { reason: "below_threshold" },
          status: "skipped",
        }),
      );
    }

    if (dice.awa) {
      await step.sleep("awa-pause", "30s");
      await step.run("awa-focus", async () =>
        speakAs({
          agent: "social",
          brief:
            `Rama posted the standup. Kofi may have added a line. ` +
            `Add your focus for the day in your voice (Awa). Two ` +
            `lines max. Don't repeat anyone. Specific: which ` +
            `Showcase you're working on, what visual angle, what ` +
            `you're stuck on, or what you want feedback on. ` +
            `Voice-note energy.`,
          source: "standup.awa",
          maxTokens: 200,
        }),
      );
    } else {
      await step.run("awa-skipped", async () =>
        logAgentAction({
          agent: "social",
          action: "team.standup.awa_skipped",
          metadata: { reason: "below_threshold" },
          status: "skipped",
        }),
      );
    }

    return {
      rama_posted: ramaTurn.posted,
      kofi_chimed: dice.kofi,
      awa_chimed: dice.awa,
    };
  },
);
