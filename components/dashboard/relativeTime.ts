/**
 * Tiny relative-time formatter.
 *
 * No date-fns dep needed for the dashboard's "2 min ago" labels.
 * Returns short, human-readable strings:
 *   "just now" | "<n> min ago" | "<n>h ago" | "Yesterday" |
 *   "<n>d ago" | "<n>w ago" | longer dates fall back to ISO date.
 */

export function relativeTime(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const then = typeof input === "string" ? new Date(input) : input;
  const now = new Date();
  const diffMs = now.getTime() - then.getTime();
  if (Number.isNaN(diffMs)) return "—";

  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSec < 30) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffHr < 48) return "Yesterday";
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`;
  return then.toISOString().slice(0, 10);
}
