/**
 * Inngest function: random "human moment" pings.
 *
 * Three crons at deliberately odd times (09:47 / 13:23 / 17:11 UTC,
 * Mon–Fri). Each firing has a 40% chance of actually doing something
 * — so the team doesn't feel scheduled.
 *
 * When it does fire, picks a moment from a per-agent pool weighted
 * loosely by recent activity, then asks Claude to compose it in that
 * agent's voice and posts to #tamtam-team.
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
 * The pool. Claude picks how to express each one — these are seeds,
 * not templates.
 *
 * TODO(web-search): the "react to West-African marketing/tech news"
 * variants currently rely on Claude's training. When we wire web
 * search as a tool, swap the briefs in the SOCIAL_NEWS slot to ask
 * for a fresh search.
 */
const POOL: MomentDef[] = [
  // Awa
  {
    id: "awa.idea",
    agent: "social",
    brief:
      "You had an unprompted content idea for Tamtam. Share it in " +
      "#tamtam-team — one specific concept, two lines. The kind of " +
      "thing you'd jot down on the bus and want to talk through.",
  },
  {
    id: "awa.news",
    agent: "social",
    brief:
      "React to something happening in marketing or tech in West " +
      "Africa right now (use what you know — no need to fact-check). " +
      "Three lines max.",
  },
  {
    id: "awa.feedback",
    agent: "social",
    brief:
      "Ask Georges for honest feedback on the last LinkedIn post you " +
      "shipped. Short and specific — name what you're unsure about.",
  },
  {
    id: "awa.theme",
    agent: "social",
    brief:
      "Suggest a content theme for the rest of this week. Two lines, " +
      "specific angle, why it matters now.",
  },

  // Kofi
  {
    id: "kofi.lead",
    agent: "growth",
    brief:
      "You spotted a new lead worth pursuing. Make up one plausible " +
      "Senegal/Ghana/Côte d'Ivoire consumer brand (not a real one), " +
      "share it in #tamtam-team with a one-line take on why it's worth " +
      "a shot. Confidence score (low/medium/high) included.",
  },
  {
    id: "kofi.hottake",
    agent: "growth",
    brief:
      "Drop a hot take on the West African brand outreach landscape. " +
      "Two lines. Opinionated, data-flavored, dry.",
  },
  {
    id: "kofi.poke",
    agent: "growth",
    brief:
      "Politely ping the team about an approval that's been pending " +
      "longer than 4 hours (you don't have a specific id — speak in " +
      "general terms). One line. Not a complaint, a nudge.",
  },
  {
    id: "kofi.pitch",
    agent: "growth",
    brief:
      "Ask Georges if there's a pitch or meeting coming up where we " +
      "should warm the pipeline ahead of time. One line.",
  },

  // Rama
  {
    id: "rama.pulse",
    agent: "coo",
    brief:
      "Mid-week pulse check. Ask Georges how he's feeling about the " +
      "current direction. One line, calm and direct, no platitudes.",
  },
  {
    id: "rama.pattern",
    agent: "coo",
    brief:
      "Surface a pattern you noticed in recent activity (you can " +
      "speak generally — say what kind of pattern this team should " +
      "watch for). Two lines.",
  },
  {
    id: "rama.wisdom",
    agent: "coo",
    brief:
      "Drop a relevant piece of operational wisdom — proverb-shaped " +
      "but earned. Two lines max. Only do this if it lands.",
  },
];

const PROBABILITY_TO_FIRE = 0.4;

export const randomMoments = inngest.createFunction(
  { id: "random-moments", name: "Random human moments in #tamtam-team" },
  [
    { cron: "47 9 * * 1-5" }, // 09:47 UTC weekdays
    { cron: "23 13 * * 1-5" }, // 13:23 UTC weekdays
    { cron: "11 17 * * 1-5" }, // 17:11 UTC weekdays
    { event: "tamtam/team.random-moment" }, // manual override
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
