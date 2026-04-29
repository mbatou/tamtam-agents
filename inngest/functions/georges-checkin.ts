/**
 * Inngest function: respond when Georges drops a casual message in
 * #tamtam-team without mentioning a specific agent.
 *
 * The Slack events route emits `tamtam/georges.checkin` only when:
 *   - SLACK_GEORGES_USER_ID is set
 *   - SLACK_CHANNEL_TEAM is set
 *   - the message arrives in the team channel
 *   - it's from Georges' user id
 *   - it's not an app_mention (those route to the per-agent flow)
 *   - it's not a bot message
 *
 * Rama responds in the team voice. If Georges asks something
 * specific ("how is the team?"), the answer is grounded in recent
 * agent_logs.
 */

import { inngest } from "@/lib/inngest";
import { speakAs } from "@/lib/team-voice";
import { getRecentAgentLogs } from "@/lib/supabase";

export const georgesCheckin = inngest.createFunction(
  { id: "georges-checkin", name: "Rama responds to Georges in #tamtam-team" },
  { event: "tamtam/georges.checkin" },
  async ({ event, step }) => {
    return step.run("respond", async () => {
      const { text, channel, thread_ts } = event.data;

      // Pull a small snapshot so Rama can answer "how is the team?"
      // honestly instead of from vibes.
      const since = new Date(
        Date.now() - 24 * 60 * 60 * 1000,
      ).toISOString();
      const [socialLogs, growthLogs] = await Promise.all([
        getRecentAgentLogs("social", since),
        getRecentAgentLogs("growth", since),
      ]);
      const snapshot =
        `Recent activity (last 24h):\n` +
        `  Awa (Social): ${socialLogs.length} log rows, ` +
        `${socialLogs.filter((r) => r.status === "completed").length} completed, ` +
        `${socialLogs.filter((r) => r.status === "failed").length} failed\n` +
        `  Kofi (Growth): ${growthLogs.length} log rows, ` +
        `${growthLogs.filter((r) => r.status === "completed").length} completed, ` +
        `${growthLogs.filter((r) => r.status === "failed").length} failed`;

      return speakAs({
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
          snapshot,
        source: "georges_checkin",
        maxTokens: 300,
      });
    });
  },
);
