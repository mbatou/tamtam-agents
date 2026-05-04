"use client";

import type { LeadStatus } from "@/types";

export interface PipelineCounts {
  total: number;
  contacted: number;
  warm: number;
  hot: number;
  converted: number;
  paused: number;
  cold: number;
  rejected: number;
}

interface StatsBarProps {
  counts: Record<LeadStatus | "total", number>;
  apollo: { used: number; budget: number };
}

export function StatsBar({ counts, apollo }: StatsBarProps): JSX.Element {
  const cells: Array<{ label: string; value: number; tone?: string }> = [
    { label: "Total", value: counts.total },
    { label: "Contacted", value: counts.contacted, tone: "text-blue-300" },
    { label: "Warm", value: counts.warm, tone: "text-yellow-300" },
    { label: "Hot", value: counts.hot, tone: "text-dakar-orange" },
    { label: "Converted", value: counts.converted, tone: "text-emerald-300" },
  ];
  return (
    <div className="grid gap-3 rounded-lg border border-dakar-border bg-dakar-surface p-4 sm:grid-cols-2 lg:grid-cols-6">
      {cells.map((c) => (
        <div key={c.label}>
          <div className="text-[0.65rem] uppercase tracking-[0.15em] text-dakar-muted">
            {c.label}
          </div>
          <div
            className={
              "mt-1 text-2xl font-semibold " +
              (c.tone ?? "text-dakar-text")
            }
          >
            {c.value}
          </div>
        </div>
      ))}
      <div>
        <div className="text-[0.65rem] uppercase tracking-[0.15em] text-dakar-muted">
          Apollo credits
        </div>
        <div className="mt-1 text-2xl font-semibold text-dakar-text">
          {apollo.used}
          <span className="text-base text-dakar-muted">
            {" "}
            / {apollo.budget}
          </span>
        </div>
      </div>
    </div>
  );
}
