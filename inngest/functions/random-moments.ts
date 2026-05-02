/**
 * Inngest function: random "human moment" pings in #tamtam-team.
 *
 * Three weekday crons at deliberately odd minutes (09:47 / 13:23 /
 * 17:11 UTC). 40% probability each firing — the rest stay quiet so
 * the team doesn't feel scheduled.
 *
 * Manual trigger (`tamtam/team.random-moment` with trigger=manual)
 * bypasses the probability gate.
 */

import { inngest } from "@/lib/inngest";
import { speakAs } from "@/lib/team-voice";
import { logAgentAction } from "@/lib/supabase";
import type { AgentName } from "@/types";

interface MomentDef {
  id: string;
  agent: AgentName;
  brief: string;
}

/**
 * Pool of moment seeds. Each is a *prompt for Claude*, not a
 * template — Awa/Kofi/Rama express each one in their own voice.
 *
 * TODO(web-search): when we wire web search as a tool, swap the
 * "react to news" briefs to ask Claude to search instead of
 * relying on training.
 */
const POOL: MomentDef[] = [
  // ─── AWA ────────────────────────────────────────────────────────────
  {
    id: "awa.idea",
    agent: "social",
    brief:
      "You had a content idea unprompted — share what specifically " +
      "inspired it (a photo, a sound, a Médina moment). Two lines.",
  },
  {
    id: "awa.next_showcase",
    agent: "social",
    brief:
      "Propose the next Use Case Showcase target for the week. The " +
      "ones already ready are Air Sénégal, BAL, Shell — propose ONE " +
      "you'd publish first and why. Two lines. Specific brand, real " +
      "reasoning.",
  },
  {
    id: "awa.competitor",
    agent: "social",
    brief:
      "React to a competitor or another West African brand doing " +
      "something interesting on social. You're allowed to make up a " +
      "plausible recent move (it's a casual chat, not a press release). " +
      "Three lines max.",
  },
  {
    id: "awa.feedback",
    agent: "social",
    brief:
      "Ask Georges for honest feedback on the last LinkedIn post that " +
      "shipped. Short, specific, name what you're unsure about.",
  },
  {
    id: "awa.angle",
    agent: "social",
    brief:
      "You found a content angle that excites you — share it. Two " +
      "lines, specific, voice-note energy.",
  },
  {
    id: "awa.warmup",
    agent: "social",
    brief:
      "Remind Kofi which brands you're warming up in content right " +
      "now so he can sequence outreach behind it. One line.",
  },

  // ─── KOFI ───────────────────────────────────────────────────────────
  {
    id: "kofi.lead",
    agent: "growth",
    brief:
      "You spotted a new lead worth pursuing — a plausible Senegalese " +
      "FMCG / fintech / e-commerce brand (make one up if needed, it's " +
      "a casual chat). One-line take + confidence score (low/medium/" +
      "high). Two lines max.",
  },
  {
    id: "kofi.competitor_gap",
    agent: "growth",
    brief:
      "Hot take: where is a competitor leaving money on the table in " +
      "Senegal right now? Two lines, opinionated, dry.",
  },
  {
    id: "kofi.timing",
    agent: "growth",
    brief:
      "Check with Awa on content timing before an outreach push you " +
      "want to do this week. One line. Direct.",
  },
  {
    id: "kofi.reply_celebrate",
    agent: "growth",
    brief:
      "A prospect just replied to outreach (you can speak generally — " +
      "it's a casual moment). Celebrate briefly in your voice. One line.",
  },
  {
    id: "kofi.pitch_check",
    agent: "growth",
    brief:
      "Ask Georges about an upcoming pitch or meeting where you should " +
      "warm the pipeline ahead. One line.",
  },
  {
    id: "kofi.tiaktiak_proof",
    agent: "growth",
    brief:
      "Reference Tiak-Tiak's early results as social proof for a " +
      "specific kind of brand you're targeting next. Two lines, " +
      "punchy.",
  },

  // ─── RAMA ───────────────────────────────────────────────────────────
  {
    id: "rama.babacar",
    agent: "coo",
    brief:
      "Find a natural moment to bring up Babacar's SAS incorporation " +
      "with Georges. NOT as a notification — as a coaching nudge. " +
      "One question, calm. Specific, not generic.",
  },
  {
    id: "rama.pattern",
    agent: "coo",
    brief:
      "Surface a pattern you noticed in recent activity (you can " +
      "speak generally). Two lines. Operational read, not a metric " +
      "dump.",
  },
  {
    id: "rama.pulse",
    agent: "coo",
    brief:
      "Mid-week pulse check: ask Georges how he's feeling about the " +
      "current direction. One line. Calm and direct, no platitudes.",
  },
  {
    id: "rama.recognize",
    agent: "coo",
    brief:
      "Note something the team did well this week — specific person, " +
      "specific action, specific impact. Two lines. Never generic.",
  },
  {
    id: "rama.showcase_nudge",
    agent: "coo",
    brief:
      "Reference a pending Showcase that should go out this week (Air " +
      "Sénégal, BAL, Shell, or Casamançaise). One line. Coaching, not " +
      "policing.",
  },
  {
    id: "rama.wisdom",
    agent: "coo",
    brief:
      "Drop a piece of operational wisdom — proverb-shaped but earned. " +
      "Two lines max. Only do this if it lands.",
  },
];

const PROBABILITY_TO_FIRE = 0.4;

export const randomMoments = inngest.createFunction(
  { id: "random-moments", name: "Random human moments in #tamtam-team" },
  [
    { cron: "47 9 * * 1-5" },
    { cron: "23 13 * * 1-5" },
    { cron: "11 17 * * 1-5" },
    { event: "tamtam/team.random-moment" },
  ],
  async ({ event, step }) => {
    const isManual =
      event && "name" in event && event.name === "tamtam/team.random-moment";

    return step.run("maybe-fire", async () => {
      const roll = Math.random();
      if (!isManual && roll >= PROBABILITY_TO_FIRE) {
        await logAgentAction({
          agent: "coo",
          action: "team.random_moment.skipped",
          metadata: { roll, threshold: PROBABILITY_TO_FIRE },
          status: "skipped",
        });
        return { fired: false, reason: "probability_check_failed", roll };
      }

      const moment = POOL[Math.floor(Math.random() * POOL.length)]!;
      await logAgentAction({
        agent: moment.agent,
        action: "team.random_moment.selected",
        metadata: { moment_id: moment.id, manual: isManual, roll },
        status: "started",
      });

      const res = await speakAs({
        agent: moment.agent,
        brief: moment.brief,
        source: `random_moment.${moment.id}`,
        maxTokens: 250,
      });

      return { fired: true, moment_id: moment.id, ...res };
    });
  },
);
