import type { LeadStatus, PostStatus } from "@/types";

type AnyStatus = LeadStatus | PostStatus;

const COLOR_MAP: Record<string, { bg: string; text: string; border: string }> = {
  // Lead statuses
  new: { bg: "bg-dakar-muted/10", text: "text-dakar-muted", border: "border-dakar-muted/30" },
  researching: { bg: "bg-dakar-muted/10", text: "text-dakar-muted", border: "border-dakar-muted/30" },
  researched: { bg: "bg-dakar-muted/10", text: "text-dakar-muted", border: "border-dakar-muted/30" },
  queued: { bg: "bg-dakar-muted/10", text: "text-dakar-muted", border: "border-dakar-muted/30" },
  contacted: { bg: "bg-blue-500/10", text: "text-blue-300", border: "border-blue-500/30" },
  warm: { bg: "bg-yellow-500/10", text: "text-yellow-300", border: "border-yellow-500/30" },
  hot: { bg: "bg-dakar-orange/15", text: "text-dakar-orange", border: "border-dakar-orange/40" },
  replied: { bg: "bg-dakar-teal/10", text: "text-dakar-teal", border: "border-dakar-teal/30" },
  paused: { bg: "bg-dakar-purple/10", text: "text-dakar-purple", border: "border-dakar-purple/30" },
  cold: { bg: "bg-dakar-border", text: "text-dakar-muted", border: "border-dakar-border" },
  rejected: { bg: "bg-dakar-error/10", text: "text-dakar-error", border: "border-dakar-error/30" },
  converted: { bg: "bg-emerald-500/10", text: "text-emerald-300", border: "border-emerald-500/30" },
  won: { bg: "bg-emerald-500/10", text: "text-emerald-300", border: "border-emerald-500/30" },
  lost: { bg: "bg-dakar-error/10", text: "text-dakar-error", border: "border-dakar-error/30" },
  do_not_contact: { bg: "bg-dakar-error/10", text: "text-dakar-error", border: "border-dakar-error/30" },

  // Post statuses
  draft: { bg: "bg-dakar-muted/10", text: "text-dakar-muted", border: "border-dakar-muted/30" },
  pending_approval: { bg: "bg-yellow-500/10", text: "text-yellow-300", border: "border-yellow-500/30" },
  approved: { bg: "bg-emerald-500/10", text: "text-emerald-300", border: "border-emerald-500/30" },
  scheduled: { bg: "bg-blue-500/10", text: "text-blue-300", border: "border-blue-500/30" },
  published: { bg: "bg-dakar-teal/10", text: "text-dakar-teal", border: "border-dakar-teal/30" },
  failed: { bg: "bg-dakar-error/10", text: "text-dakar-error", border: "border-dakar-error/30" },
};

const FALLBACK = COLOR_MAP.researched!;

export function StatusBadge({
  status,
}: {
  status: AnyStatus;
}): JSX.Element {
  const c = COLOR_MAP[status] ?? FALLBACK;
  return (
    <span
      className={
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wide " +
        `${c.bg} ${c.text} ${c.border}`
      }
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
