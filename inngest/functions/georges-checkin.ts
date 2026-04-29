/**
 * Inngest function: respond when Georges drops a casual message in
 * #tamtam-team without mentioning a specific agent.
 *
 * Conversation shape:
 *   1. Rama responds first as the team voice (always).
 *   2. ~2.5s pause.
 *   3. 60% chance Kofi chimes in with his angle.
 *   4. ~2.5s pause.
 *   5. 40% chance Awa adds her warmth.
 *
 * The pauses use awaited setTimeout so the three messages land in
 * Slack with realistic typing-cadence gaps. The whole sequence is one
 * Inngest function execution (~6–9s including LLM calls).
 *
 * Each agent generates from their own personality system prompt via
 * speakAs(). Kofi and Awa are told what was said before them so they
 * don't repeat.
 *
 * Triggered only when:
 *   - SLACK_GEORGES_USER_ID is set
 *   - SLACK_CHANNEL_TEAM is set
 *   - the message arrives in the team channel
 *   - it's from Georges' user id (filtered upstream in the events route)
 *   - it's not an app_mention or a bot message (filtered upstream)
 */

import { inngest } from "@/lib/inngest";
import { speakAs } from "@/lib/team-voice";
import { getRecentAgentLogs, logAgentAction } from "@/lib/supabase";

/** Awaited delay so Slack sees realistic gaps between agent messages. */
function pause(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(minMs + Math.random() * (maxMs - minMs));
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const KOFI_PROBABILITY = 0.6;
const AWA_PROBABILITY = 0.4;

export const georgesCheckin = inngest.createFunction(
  {
    id: "georges-checkin",
    name: "Team responds to Georges in #tamtam-team",
    // Cap concurrency at 1 per channel so two rapid messages don't
    // produce overlapping conversations.
    concurrency: { limit: 1, key: "event.data.channel" },
  },
  { event: "tamtam/georges.checkin" },
  async ({ event, step }) => {
    const { text, channel, thread_ts } = event.data;

    // Pull a small snapshot so Rama can answer "how is the team?"
    // honestly instead of from vibes. Single Inngest step so it's
    // checkpointed and replays cheaply.
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

    // Step 1: Rama responds first.
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
    }));

    // Step 2: Kofi maybe chimes in after a 2–3s pause.
    let kofiTurn: Awaited<ReturnType<typeof speakAs>> | null = null;
    if (dice.kofi) {
      kofiTurn = await step.run("kofi-chimes-in", async () => {
        await pause(2000, 3000);
        return speakAs({
          agent: "growth",
          channel,
          threadTs: thread_ts,
          brief:
            `Georges just said in #tamtam-team:\n` +
            `> ${text}\n\n` +
            `Rama already replied as the team voice. Don't repeat ` +
            `her. Chime in with your Growth angle — your hot take, ` +
            `or a relevant question, or a status from your side. ` +
            `One or two lines. Sound like you're walking up to a ` +
            `conversation already in progress.\n\n` +
            (ramaTurn.text
              ? `What Rama just said:\n> ${ramaTurn.text}\n\n`
              : "") +
            snapshotBlock,
          source: "georges_checkin.kofi",
          maxTokens: 200,
        });
      });
    } else {
      await step.run("kofi-skipped", async () =>
        logAgentAction({
          agent: "growth",
          action: "team.georges_checkin.kofi_skipped",
          metadata: { roll: "below_threshold" },
          status: "skipped",
        }),
      );
    }

    // Step 3: Awa maybe adds warmth after another 2–3s pause.
    if (dice.awa) {
      await step.run("awa-chimes-in", async () => {
        await pause(2000, 3000);
        return speakAs({
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
        });
      });
    } else {
      await step.run("awa-skipped", async () =>
        logAgentAction({
          agent: "social",
          action: "team.georges_checkin.awa_skipped",
          metadata: { roll: "below_threshold" },
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
