/**
 * Human-behavior layer (Session 4 → Session 5 pruned).
 *
 * Two primitives now:
 *   - getResponseDelay(agent) — how long to "think" before replying
 *   - currentStatusFor(agent) — which active status to show in Slack
 *
 * The working-hours gate (and the out-of-hours auto-reply) was
 * removed: Augusta's anglophone team works across timezones and the
 * gate was producing confusing "I'm offline" replies during normal
 * conversation hours. Agents now reply at any time of day; the
 * only "this feels human" affordance is the random response delay.
 *
 * Status rotation is cosmetic and harmless, so it stays — but only
 * cycles through *active* statuses (no "Done for today" / offline).
 */

import type { AgentName } from "@/types";

/* -------------------------------------------------------------------------- */
/*  Response delay                                                            */
/* -------------------------------------------------------------------------- */

interface DelayRange {
  minMs: number;
  maxMs: number;
}

const RESPONSE_DELAY: Record<AgentName, DelayRange> = {
  social: {
    minMs: 5 * 60 * 1000, // 5 min — Awa is mid-caption
    maxMs: 15 * 60 * 1000, // 15 min
  },
  growth: {
    minMs: 2 * 60 * 1000, // 2 min — Kofi is near his phone
    maxMs: 8 * 60 * 1000, // 8 min
  },
  coo: {
    minMs: 3 * 60 * 1000, // 3 min — Rama reads before responding
    maxMs: 10 * 60 * 1000, // 10 min
  },
};

/**
 * Random delay in milliseconds the agent should "think" before
 * replying. Pass to step.sleep so the wait is observable in Inngest
 * and survives function restarts.
 */
export function getResponseDelay(agent: AgentName): number {
  const r = RESPONSE_DELAY[agent];
  return r.minMs + Math.floor(Math.random() * (r.maxMs - r.minMs));
}

/**
 * Format a millisecond delay as the duration string Inngest's
 * step.sleep expects (e.g. "180s"). Rounded to seconds — sub-second
 * precision is irrelevant for human-feel delays and would be ugly
 * in the Inngest dashboard.
 */
export function delayToInngest(ms: number): string {
  return `${Math.max(1, Math.round(ms / 1000))}s`;
}

/* -------------------------------------------------------------------------- */
/*  Status rotation — active-only, cyclic                                     */
/* -------------------------------------------------------------------------- */

export interface StatusSlot {
  /** Status text. */
  text: string;
  /** Slack emoji code, e.g. `:art:`. */
  emoji: string;
}

/**
 * Each agent's pool of *active* statuses. The status-rotation cron
 * cycles through them deterministically based on the current
 * 30-minute slot (so two ticks an hour apart land on different
 * statuses). No offline / "Done for today" / lunch entries — the
 * agents are always shown as working at something.
 */
export const STATUS_CYCLE: Record<AgentName, ReadonlyArray<StatusSlot>> = {
  social: [
    { text: "Creating content", emoji: ":art:" },
    { text: "Writing", emoji: ":writing_hand:" },
    { text: "Reviewing metrics", emoji: ":bar_chart:" },
    { text: "Community", emoji: ":speech_balloon:" },
  ],
  growth: [
    { text: "Prospecting", emoji: ":mag:" },
    { text: "Outreach", emoji: ":email:" },
    { text: "Follow-ups", emoji: ":telephone_receiver:" },
    { text: "Pipeline review", emoji: ":chart_with_upwards_trend:" },
  ],
  coo: [
    { text: "Reviewing logs", emoji: ":clipboard:" },
    { text: "Strategy", emoji: ":brain:" },
    { text: "Team check-ins", emoji: ":busts_in_silhouette:" },
    { text: "Ops review", emoji: ":bar_chart:" },
  ],
};

/**
 * Pick the active status for the given agent at the given moment.
 *
 * Deterministic cycle — index = floor(epoch_minutes / 30) % cycle.length
 * The cron fires every 30 minutes; consecutive ticks therefore land
 * on consecutive statuses. No persistence required.
 */
export function currentStatusFor(
  agent: AgentName,
  date: Date = new Date(),
): StatusSlot {
  const cycle = STATUS_CYCLE[agent];
  const slotIndex = Math.floor(date.getTime() / (30 * 60 * 1000)) % cycle.length;
  return cycle[slotIndex]!;
}
