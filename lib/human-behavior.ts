/**
 * Human-behavior layer.
 *
 * Three primitives the agents read before responding:
 *   - isWithinWorkingHours(agent) — yes/no
 *   - getResponseDelay(agent)     — how long to "think" before replying
 *   - getOutOfHoursMessage(agent) — the auto-reply when off the clock
 *
 * All times are WAT (UTC+0). Dakar is on UTC+0 year-round, so we just
 * read UTC directly — no timezone library needed.
 *
 * COO cron jobs (standup, daily brief, friday wrap-up, status
 * rotation) bypass the working-hours gate — Rama sets her own
 * schedule via the cron triggers themselves.
 */

import type { AgentName } from "@/types";

/* -------------------------------------------------------------------------- */
/*  Schedule definitions                                                      */
/* -------------------------------------------------------------------------- */

export interface WorkingHours {
  /** Inclusive start hour, 0–23 (WAT/UTC). */
  start: number;
  /** Exclusive end hour. */
  end: number;
  /** ISO weekday numbers (Mon=1 … Sun=7). */
  workdays: ReadonlyArray<number>;
  /** Inclusive lunch start hour (set both equal to disable). */
  lunchStart: number;
  /** Exclusive lunch end hour. */
  lunchEnd: number;
  /** Probability (0–1) of replying outside working hours. */
  lateNightChance: number;
}

export const WORKING_HOURS: Record<AgentName, WorkingHours> = {
  social: {
    start: 9,
    end: 18,
    workdays: [1, 2, 3, 4, 5],
    lunchStart: 13,
    lunchEnd: 14,
    lateNightChance: 0,
  },
  growth: {
    start: 8,
    end: 19,
    workdays: [1, 2, 3, 4, 5, 6],
    lunchStart: 13,
    lunchEnd: 14,
    lateNightChance: 0.15,
  },
  coo: {
    start: 7,
    end: 19,
    workdays: [1, 2, 3, 4, 5],
    lunchStart: 13,
    lunchEnd: 14,
    lateNightChance: 0,
  },
};

/* -------------------------------------------------------------------------- */
/*  Time helpers                                                              */
/* -------------------------------------------------------------------------- */

/** ISO weekday: Mon=1, Sun=7. JS getUTCDay() returns Sun=0..Sat=6. */
export function isoWeekdayUTC(date: Date = new Date()): number {
  const d = date.getUTCDay();
  return d === 0 ? 7 : d;
}

export function hourUTC(date: Date = new Date()): number {
  return date.getUTCHours();
}

/* -------------------------------------------------------------------------- */
/*  Working hours gate                                                        */
/* -------------------------------------------------------------------------- */

/**
 * True if the agent is currently "available". Returns false outside
 * the start/end window, during lunch, on a non-workday — except for
 * Kofi, who has a configurable chance of being available late.
 *
 * The lateNightChance roll is *per call*, so the same off-hours
 * message can produce different decisions on retry — by design,
 * Kofi being "near his phone late" is non-deterministic.
 */
export function isWithinWorkingHours(
  agent: AgentName,
  date: Date = new Date(),
): boolean {
  const cfg = WORKING_HOURS[agent];
  const day = isoWeekdayUTC(date);
  const hour = hourUTC(date);

  const onWorkday = cfg.workdays.includes(day);
  const inWindow = hour >= cfg.start && hour < cfg.end;
  const inLunch = hour >= cfg.lunchStart && hour < cfg.lunchEnd;

  if (onWorkday && inWindow && !inLunch) return true;

  if (cfg.lateNightChance > 0 && Math.random() < cfg.lateNightChance) {
    return true;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/*  Response delay                                                            */
/* -------------------------------------------------------------------------- */

interface DelayRange {
  minMs: number;
  maxMs: number;
}

const RESPONSE_DELAY: Record<AgentName, DelayRange> = {
  social: {
    minMs: 5 * 60 * 1000, // 5 min
    maxMs: 15 * 60 * 1000, // 15 min
  },
  growth: {
    minMs: 2 * 60 * 1000, // 2 min
    maxMs: 8 * 60 * 1000, // 8 min
  },
  coo: {
    minMs: 3 * 60 * 1000, // 3 min
    maxMs: 10 * 60 * 1000, // 10 min
  },
};

/**
 * Random delay in milliseconds the agent should "think" before
 * replying. Pass to step.sleep so the wait is observable in Inngest
 * and survives function restarts.
 *
 * Convert to a duration string with `delayToInngest(ms)`.
 */
export function getResponseDelay(agent: AgentName): number {
  const r = RESPONSE_DELAY[agent];
  return r.minMs + Math.floor(Math.random() * (r.maxMs - r.minMs));
}

/**
 * Format a millisecond delay as the duration string Inngest's
 * step.sleep expects (e.g. "180s"). We round to seconds — sub-second
 * precision is irrelevant for human-feel delays and would be ugly
 * in the Inngest dashboard.
 */
export function delayToInngest(ms: number): string {
  return `${Math.max(1, Math.round(ms / 1000))}s`;
}

/* -------------------------------------------------------------------------- */
/*  Out-of-hours messages                                                     */
/* -------------------------------------------------------------------------- */

const OUT_OF_HOURS: Record<AgentName, ReadonlyArray<string>> = {
  social: [
    "I'm offline — back tomorrow at 9 🎨",
    "finishing something personal, back at 9",
    "not at my desk — see you in the morning",
    "wrapping up for the night, will respond in the AM ✨",
  ],
  growth: [
    "I'll pick this up in the morning charle",
    "offline for now, back at 8",
    "catching some rest, on it tomorrow",
    "out of office for the night — first thing tomorrow",
  ],
  coo: [
    "Back at 7am. Leave it here, I'll see it.",
    "signing off — I'll have eyes on this by 7",
    "team is resting. Back tomorrow voilà",
    "off the clock. Tomorrow morning we move.",
  ],
};

/**
 * Pick a random out-of-hours line for the agent. Always returns
 * something — the array is never empty.
 */
export function getOutOfHoursMessage(agent: AgentName): string {
  const lines = OUT_OF_HOURS[agent];
  const idx = Math.floor(Math.random() * lines.length);
  return lines[idx]!;
}

/* -------------------------------------------------------------------------- */
/*  Status rotation schedule                                                  */
/* -------------------------------------------------------------------------- */

export interface StatusSlot {
  /** Inclusive start hour (UTC/WAT). */
  fromHour: number;
  /** Status text, empty string clears. */
  text: string;
  /** Slack emoji code, empty string clears. */
  emoji: string;
}

/**
 * Each agent's hourly profile-status schedule. Resolved by
 * `currentStatusFor(agent, date)` — picks the slot whose `fromHour`
 * is the largest one ≤ current hour.
 *
 * On non-workdays the schedule still applies (off-by-default first
 * slot makes the status clear naturally).
 */
export const STATUS_SCHEDULE: Record<AgentName, ReadonlyArray<StatusSlot>> = {
  social: [
    { fromHour: 0, text: "", emoji: "" },
    { fromHour: 9, text: "Creating content", emoji: ":art:" },
    { fromHour: 10, text: "Writing", emoji: ":writing_hand:" },
    { fromHour: 13, text: "Back at 2pm", emoji: ":knife_fork_plate:" },
    { fromHour: 14, text: "Reviewing metrics", emoji: ":bar_chart:" },
    { fromHour: 16, text: "Community", emoji: ":speech_balloon:" },
    { fromHour: 18, text: "Done for today", emoji: ":white_check_mark:" },
  ],
  growth: [
    { fromHour: 0, text: "", emoji: "" },
    { fromHour: 8, text: "Prospecting", emoji: ":mag:" },
    { fromHour: 10, text: "Outreach", emoji: ":email:" },
    { fromHour: 13, text: "Back at 2pm", emoji: ":knife_fork_plate:" },
    { fromHour: 14, text: "Follow-ups", emoji: ":telephone_receiver:" },
    { fromHour: 16, text: "Pipeline review", emoji: ":chart_with_upwards_trend:" },
    { fromHour: 19, text: "Done for today", emoji: ":white_check_mark:" },
  ],
  coo: [
    { fromHour: 0, text: "", emoji: "" },
    { fromHour: 7, text: "Morning review", emoji: ":clipboard:" },
    { fromHour: 9, text: "Strategy", emoji: ":brain:" },
    { fromHour: 13, text: "Back at 2pm", emoji: ":knife_fork_plate:" },
    { fromHour: 14, text: "Team check-ins", emoji: ":busts_in_silhouette:" },
    { fromHour: 17, text: "End of day wrap", emoji: ":bar_chart:" },
    { fromHour: 19, text: "Done for today", emoji: ":white_check_mark:" },
  ],
};

/**
 * Resolve the status slot the agent should be in right now.
 * Lunch handling: 13:00 → "Back at 2pm" lives in the schedule
 * itself (slot transitions naturally), so callers don't special-case
 * it.
 */
export function currentStatusFor(
  agent: AgentName,
  date: Date = new Date(),
): StatusSlot {
  const hour = hourUTC(date);
  const schedule = STATUS_SCHEDULE[agent];
  let chosen: StatusSlot = schedule[0]!;
  for (const slot of schedule) {
    if (slot.fromHour <= hour) chosen = slot;
    else break;
  }
  return chosen;
}
