/**
 * Inngest function: respond when Georges drops a casual message in
 * #tamtam-team without mentioning a specific agent.
 *
 * Sequence:
 *   1. activity-snapshot      — pull 24h of agent_logs
 *   2. rama-responds          — Rama replies in 2–3 sentences max
 *   3. step.sleep 3–5s        — Kofi pause
 *   4. kofi-chimes-in         — Claude decides SKIP or chime; in chime,
 *                               directly references Rama by name
 *   5. step.sleep 3–5s        — Awa pause
 *   6. awa-chimes-in          — Claude decides SKIP or chime; if chime,
 *                               references Rama and/or Kofi
 *
 * Idempotency:
 *   - Inngest event id `georges-checkin-${slack_event_id}` (set by
 *     /api/slack/events) → Inngest's native dedup collapses retries.
 *   - concurrency.key on event.data.slack_event_id → defensive
 *     in-flight collision guard inside Inngest.
 */

import { inngest } from "@/lib/inngest";
import { speakAs } from "@/lib/team-voice";
import { getRecentAgentLogs } from "@/lib/supabase";

/** Random duration string in [minS..maxS] seconds, e.g. "4s". */
function randomSleepDuration(minS: number, maxS: number): string {
  const seconds = Math.floor(minS + Math.random() * (maxS - minS));
  return `${seconds}s`;
}

export const georgesCheckin = inngest.createFunction(
  {
    id: "georges-checkin",
    name: "Team responds to Georges in #tamtam-team",
    // Defensive in-flight guard. The /api/slack/events route sets an
    // Inngest event id of `georges-checkin-${slack_event_id}` which
    // does the heavy lifting; this concurrency key adds a second
    // layer for the case where two distinct events somehow share an
    // event_id at the function-trigger boundary.
    concurrency: { limit: 1, key: "event.data.slack_event_id" },
  },
  { event: "tamtam/georges.checkin" },
  async ({ event, step }) => {
    const { text, channel, thread_ts } = event.data;

    const snapshot = await step.run("activity-snapshot", async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [socialLogs, growthLogs] = await Promise.all([
        getRecentAgentLogs("social", since),
        getRecentAgentLogs("growth", since),
      ]);
      return {
        social: {
          rows: socialLogs.length,
          completed: socialLogs.filter((r) => r.status === "completed").length,
          failed: socialLogs.filter((r) => r.status === "failed").length,
        },
        growth: {
          rows: growthLogs.length,
          completed: growthLogs.filter((r) => r.status === "completed").length,
          failed: growthLogs.filter((r) => r.status === "failed").length,
        },
      };
    });

    const snapshotBlock =
      `Recent activity (last 24h):\n` +
      `  Awa (Social): ${snapshot.social.rows} log rows, ` +
      `${snapshot.social.completed} completed, ${snapshot.social.failed} failed\n` +
      `  Kofi (Growth): ${snapshot.growth.rows} log rows, ` +
      `${snapshot.growth.completed} completed, ${snapshot.growth.failed} failed`;

    // Rama: tight, warm, no full reports. 2–3 sentences MAX.
    const ramaTurn = await step.run("rama-responds", async () =>
      speakAs({
        agent: "coo",
        channel,
        threadTs: thread_ts,
        brief:
          `Georges sent a casual check-in message in #tamtam-team:\n` +
          `> ${text}\n\n` +
          `Respond as Rama in 2–3 SENTENCES MAXIMUM. Be direct and ` +
          `warm. Pick at most ONE update to give and at most ONE ` +
          `question to ask — never both at full length. This is a ` +
          `quick check-in, NOT a brief. No bullet lists. No status ` +
          `recap. After you reply, Kofi and Awa may add one line ` +
          `each if they have something specific to say.\n\n` +
          snapshotBlock,
        source: "georges_checkin.rama",
        maxTokens: 200,
      }),
    );

    // 3–5s pause before Kofi might chime in.
    await step.sleep("kofi-pause", randomSleepDuration(3, 6));

    // Kofi: contextual SKIP. Claude decides whether to chime — no dice.
    const kofiTurn = await step.run("kofi-chimes-in", async () =>
      speakAs({
        agent: "growth",
        channel,
        threadTs: thread_ts,
        brief:
          `Georges said:\n> ${text}\n\n` +
          `Rama just replied:\n> ${ramaTurn.text ?? ""}\n\n` +
          `Decide as Kofi: do you have something SPECIFIC and ` +
          `valuable to add here that Rama did not cover? Something ` +
          `concrete from your side — a lead, a deadline, a Tiak-Tiak ` +
          `data point, an honest pushback?\n\n` +
          `If YES — respond in character. ONE line, MAX two. ` +
          `Reference Rama by name (e.g. "Rama's right —", "to Rama's ` +
          `point —"). Don't deliver a parallel report. Connect ` +
          `directly to what was said.\n\n` +
          `If you have NOTHING genuinely additive — respond with ` +
          `EXACTLY: SKIP\n\n` +
          `Do not pad. SKIP is the correct answer when you don't ` +
          `have something specific.`,
        source: "georges_checkin.kofi",
        maxTokens: 200,
        skipMarker: "SKIP",
      }),
    );

    await step.sleep("awa-pause", randomSleepDuration(3, 6));

    // Awa: contextual SKIP. Sees Rama AND Kofi (if posted).
    await step.run("awa-chimes-in", async () =>
      speakAs({
        agent: "social",
        channel,
        threadTs: thread_ts,
        brief:
          `Georges said:\n> ${text}\n\n` +
          `Rama replied:\n> ${ramaTurn.text ?? ""}\n\n` +
          (kofiTurn.text
            ? `Kofi added:\n> ${kofiTurn.text}\n\n`
            : `Kofi stayed quiet.\n\n`) +
          `Decide as Awa: do you have something SPECIFIC and ` +
          `valuable to add — your warmth, a creative angle, a ` +
          `Showcase reference, a small reaction to what was said?\n\n` +
          `If YES — respond in character. ONE line, MAX two. ` +
          `Reference Rama or Kofi by name to keep it a real ` +
          `conversation (e.g. "to Kofi's point —", "Rama —"). ` +
          `Voice-note energy. Don't repeat anyone.\n\n` +
          `If you have NOTHING genuinely additive — respond with ` +
          `EXACTLY: SKIP`,
        source: "georges_checkin.awa",
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
