/**
 * Inngest function: morning standup in #tamtam-team.
 *
 * Cron: 08:00 UTC, Mon–Fri (08:00 WAT — Dakar is UTC+0).
 *
 * Sequence:
 *   1. Pull last 24h of agent_logs
 *   2. Rama posts the standup, referencing actual yesterday activity
 *   3. step.sleep 30s → Kofi chimes IF he has something to add to
 *      what Rama said (SKIP otherwise — no dice)
 *   4. step.sleep 30s → Awa chimes IF she has something to add to
 *      what Rama or Kofi said (SKIP otherwise)
 *
 * The chime-ins reference the prior speaker by name so the thread
 * reads like a real morning conversation, not three parallel
 * monologues.
 */

import { inngest } from "@/lib/inngest";
import { getRecentAgentLogs } from "@/lib/supabase";
import { speakAs } from "@/lib/team-voice";

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
      };
    });

    const ramaTurn = await step.run("rama-standup", async () =>
      speakAs({
        agent: "coo",
        brief:
          `It is a weekday morning in Dakar. Compose the team standup ` +
          `for #tamtam-team. Acknowledge what happened yesterday ` +
          `(specific, never generic). Set the tone for today. Name ` +
          `Awa and Kofi with their priorities. If the Tiak-Tiak ` +
          `J+7 / J+15 dates are relevant given the current date, ` +
          `surface them naturally. (Babacar's SAS: surface ONLY if ` +
          `it has not already been raised today and only if it ` +
          `genuinely fits — never as a daily reminder.) 6 lines max. ` +
          `1–2 emojis at most. Speak like a leader who read the ` +
          `logs, not a reporter listing them.\n\n` +
          `Yesterday's activity:\n` +
          snapshot.block,
        source: "standup.rama",
        maxTokens: 450,
      }),
    );

    await step.sleep("kofi-pause", "30s");

    // Kofi: contextual SKIP. He chimes only if he has something
    // that builds on Rama's standup — not a parallel report.
    const kofiTurn = await step.run("kofi-plan", async () =>
      speakAs({
        agent: "growth",
        brief:
          `Rama just posted the morning standup in #tamtam-team:\n` +
          `> ${ramaTurn.text ?? ""}\n\n` +
          `Decide as Kofi: do you have something to add that DIRECTLY ` +
          `BUILDS on what Rama said? A specific lead you're chasing ` +
          `today, a Tiak-Tiak data point, a follow-up timing question ` +
          `for her, a hot pushback?\n\n` +
          `If YES — ONE line, max two. Reference Rama by name (e.g. ` +
          `"to Rama's point on Air Sénégal —"). Don't deliver an ` +
          `independent update — respond TO her standup.\n\n` +
          `If you have NOTHING that genuinely connects — respond with ` +
          `EXACTLY: SKIP`,
        source: "standup.kofi",
        maxTokens: 200,
        skipMarker: "SKIP",
      }),
    );

    await step.sleep("awa-pause", "30s");

    // Awa: contextual SKIP. References Rama and/or Kofi.
    await step.run("awa-focus", async () =>
      speakAs({
        agent: "social",
        brief:
          `Rama posted the standup:\n> ${ramaTurn.text ?? ""}\n\n` +
          (kofiTurn.text
            ? `Kofi added:\n> ${kofiTurn.text}\n\n`
            : `Kofi stayed quiet.\n\n`) +
          `Decide as Awa: do you have something to add that BUILDS on ` +
          `what Rama said${kofiTurn.text ? " or what Kofi said" : ""}? ` +
          `A Showcase you're working on today, a visual angle, a ` +
          `question for one of them?\n\n` +
          `If YES — ONE line, max two. Reference Rama or Kofi by ` +
          `name. React to them, don't run alongside.\n\n` +
          `If you have NOTHING genuinely connective — respond with ` +
          `EXACTLY: SKIP`,
        source: "standup.awa",
        maxTokens: 200,
        skipMarker: "SKIP",
      }),
    );

    return {
      rama_posted: ramaTurn.posted,
      kofi_chimed: kofiTurn.posted,
    };
  },
);
