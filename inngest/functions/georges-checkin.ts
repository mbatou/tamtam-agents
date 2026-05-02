/**
 * Inngest function: respond when Georges drops a casual message in
 * #tamtam-team without mentioning a specific agent.
 *
 * Sequence:
 *   1. activity-snapshot   — pull 24h of agent_logs
 *   2. rama-responds       — Rama replies first (always)
 *   3. roll-dice           — Math.random in a step (deterministic on replay)
 *   4. step.sleep 2-3s     — kofi pause
 *   5. kofi-chimes-in      — 60% chance Kofi adds his angle
 *   6. step.sleep 2-3s     — awa pause
 *   7. awa-chimes-in       — 40% chance Awa adds her warmth
 *
 * step.sleep (not setTimeout) so the pauses are observable in
 * Inngest, survive function restarts, and don't burn warm-function
 * compute time during the wait.
 *
 * concurrency: { limit: 1, key: event.data.channel } — back-to-back
 * Georges messages queue rather than overlap.
 */

import { inngest } from "@/lib/inngest";
import { speakAs } from "@/lib/team-voice";
import { getRecentAgentLogs, logAgentAction } from "@/lib/supabase";

const KOFI_PROBABILITY = 0.6;
const AWA_PROBABILITY = 0.4;

/** Random duration string in [minS..maxS] seconds, e.g. "3s". */
function randomSleepDuration(minS: number, maxS: number): string {
  const seconds = Math.floor(minS + Math.random() * (maxS - minS));
  return `${seconds}s`;
}

export const georgesCheckin = inngest.createFunction(
  {
    id: "georges-checkin",
    name: "Team responds to Georges in #tamtam-team",
    concurrency: { limit: 1, key: "event.data.channel" },
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

    const ramaTurn = await step.run("rama-responds", async () =>
      speakAs({
        agent: "coo",
        channel,
        threadTs: thread_ts,
        brief:
          `Georges just walked into #tamtam-team and said:\n` +
          `> ${text}\n\n` +
          `Respond as the team voice (you, Rama). Welcoming if it's ` +
          `a hello. Honest and grounded if it's a question — use the ` +
          `snapshot below, don't make things up. If he shared news, ` +
          `acknowledge it warmly. Three lines max. No quoting his ` +
          `message back at him.\n\n` +
          snapshotBlock,
        source: "georges_checkin.rama",
        maxTokens: 300,
      }),
    );

    // Roll dice ONCE inside a step so replays are deterministic.
    const dice = await step.run("roll-dice", async () => ({
      kofi: Math.random() < KOFI_PROBABILITY,
      awa: Math.random() < AWA_PROBABILITY,
      kofi_pause: randomSleepDuration(2, 4),
      awa_pause: randomSleepDuration(2, 4),
    }));

    let kofiTurn: Awaited<ReturnType<typeof speakAs>> | null = null;
    if (dice.kofi) {
      await step.sleep("kofi-pause", dice.kofi_pause);
      kofiTurn = await step.run("kofi-chimes-in", async () =>
        speakAs({
          agent: "growth",
          channel,
          threadTs: thread_ts,
          brief:
            `Georges just said in #tamtam-team:\n` +
            `> ${text}\n\n` +
            `Rama already replied as the team voice. Don't repeat ` +
            `her. Chime in with your Growth angle — your hot take, ` +
            `or a relevant question, or a status from your side. ` +
            `One or two lines.\n\n` +
            (ramaTurn.text
              ? `What Rama just said:\n> ${ramaTurn.text}\n\n`
              : "") +
            snapshotBlock,
          source: "georges_checkin.kofi",
          maxTokens: 200,
        }),
      );
    } else {
      await step.run("kofi-skipped", async () =>
        logAgentAction({
          agent: "growth",
          action: "team.georges_checkin.kofi_skipped",
          metadata: { reason: "below_threshold" },
          status: "skipped",
        }),
      );
    }

    if (dice.awa) {
      await step.sleep("awa-pause", dice.awa_pause);
      await step.run("awa-chimes-in", async () =>
        speakAs({
          agent: "social",
          channel,
          threadTs: thread_ts,
          brief:
            `Georges just said in #tamtam-team:\n` +
            `> ${text}\n\n` +
            `Rama and ${dice.kofi ? "Kofi" : "the team"} already ` +
            `responded. Don't repeat them. Add your warmth — your ` +
            `creative angle, a small reaction, something specific. ` +
            `One or two lines. Voice-note energy.\n\n` +
            (ramaTurn.text
              ? `What Rama said:\n> ${ramaTurn.text}\n\n`
              : "") +
            (kofiTurn?.text
              ? `What Kofi said:\n> ${kofiTurn.text}\n\n`
              : ""),
          source: "georges_checkin.awa",
          maxTokens: 200,
        }),
      );
    } else {
      await step.run("awa-skipped", async () =>
        logAgentAction({
          agent: "social",
          action: "team.georges_checkin.awa_skipped",
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
