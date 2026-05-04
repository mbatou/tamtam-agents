"use client";

import { useCallback, useEffect, useState } from "react";
import { StatusBadge } from "./StatusBadge";
import { StatsBar } from "./StatsBar";
import { AddLeadModal } from "./AddLeadModal";
import { useToast } from "./Toast";
import { relativeTime } from "./relativeTime";
import type { Lead, LeadStatus } from "@/types";

const REFRESH_INTERVAL_MS = 30_000;

const STATUS_OPTIONS: ReadonlyArray<LeadStatus> = [
  "researched",
  "contacted",
  "warm",
  "hot",
  "paused",
  "cold",
  "converted",
  "rejected",
];

export function PipelineTable({ token }: { token: string }): JSX.Element {
  const [rows, setRows] = useState<Lead[]>([]);
  const [counts, setCounts] = useState<Record<LeadStatus | "total", number>>({
    total: 0,
    new: 0,
    researching: 0,
    researched: 0,
    queued: 0,
    contacted: 0,
    warm: 0,
    hot: 0,
    replied: 0,
    cold: 0,
    rejected: 0,
    paused: 0,
    converted: 0,
    won: 0,
    lost: 0,
    do_not_contact: 0,
  });
  const [apollo, setApollo] = useState<{ used: number; budget: number }>({
    used: 0,
    budget: 75,
  });
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const refresh = useCallback(async () => {
    const params = new URLSearchParams({ token });
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (sourceFilter !== "all") params.set("source", sourceFilter);
    if (search.trim()) params.set("q", search.trim());
    try {
      const res = await fetch(`/api/dashboard/leads?${params.toString()}`);
      if (!res.ok) {
        toast.push("Pipeline refresh failed", "error");
        return;
      }
      const data = (await res.json()) as {
        rows: Lead[];
        counts: Record<LeadStatus | "total", number>;
        apollo: { used: number; budget: number };
      };
      setRows(data.rows);
      setCounts(data.counts);
      setApollo(data.apollo);
    } catch {
      toast.push("Pipeline refresh failed", "error");
    } finally {
      setLoading(false);
    }
  }, [token, statusFilter, sourceFilter, search, toast]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const updateStatus = async (
    leadId: string,
    status: LeadStatus,
  ): Promise<void> => {
    try {
      const res = await fetch(
        `/api/dashboard/leads/${leadId}?token=${encodeURIComponent(token)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.push(`Status → ${status}`, "success");
      await refresh();
    } catch (err) {
      toast.push(
        `Status update failed: ${err instanceof Error ? err.message : "unknown"}`,
        "error",
      );
    }
  };

  const deleteLead = async (leadId: string): Promise<void> => {
    if (!confirm("Delete this lead permanently?")) return;
    try {
      const res = await fetch(
        `/api/dashboard/leads/${leadId}?token=${encodeURIComponent(token)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.push("Lead deleted", "success");
      await refresh();
    } catch (err) {
      toast.push(
        `Delete failed: ${err instanceof Error ? err.message : "unknown"}`,
        "error",
      );
    }
  };

  const togglePause = async (lead: Lead): Promise<void> => {
    const next: LeadStatus = lead.status === "paused" ? "contacted" : "paused";
    await updateStatus(lead.id, next);
  };

  return (
    <div className="space-y-4">
      <StatsBar counts={counts} apollo={apollo} />

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-dakar-border bg-dakar-surface px-3 py-1.5 text-xs text-dakar-text"
        >
          <option value="all">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="rounded-md border border-dakar-border bg-dakar-surface px-3 py-1.5 text-xs text-dakar-text"
        >
          <option value="all">All sources</option>
          <option value="apollo">Apollo</option>
          <option value="manual">Manual</option>
          <option value="claude">Claude</option>
        </select>
        <input
          type="text"
          placeholder="Search company / email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[180px] rounded-md border border-dakar-border bg-dakar-surface px-3 py-1.5 text-xs text-dakar-text outline-none focus:border-dakar-orange"
        />
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="rounded-md bg-dakar-orange px-4 py-1.5 text-xs font-medium text-white hover:bg-dakar-orange/90"
        >
          + Add lead
        </button>
      </div>

      {loading && rows.length === 0 ? (
        <div className="h-48 animate-pulse rounded-lg border border-dakar-border bg-dakar-surface" />
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dakar-border bg-dakar-surface p-12 text-center text-sm text-dakar-muted">
          No leads yet — Kofi&apos;s on it 📈
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-dakar-border">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead className="bg-dakar-surface text-[0.65rem] uppercase tracking-wider text-dakar-muted">
              <tr>
                <Th>Company</Th>
                <Th>Contact</Th>
                <Th>Email</Th>
                <Th>Status</Th>
                <Th>Score</Th>
                <Th>Last contact</Th>
                <Th>Day 4</Th>
                <Th>Day 9</Th>
                <Th>Notes</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((lead) => (
                <tr
                  key={lead.id}
                  className="group border-t border-dakar-border bg-dakar-bg/40 hover:bg-dakar-surface"
                >
                  <Td className="font-medium text-dakar-text">{lead.company}</Td>
                  <Td className="text-dakar-muted">
                    {lead.contact_name ?? "—"}
                    {lead.contact_title && (
                      <div className="text-[0.65rem] text-dakar-muted/70">
                        {lead.contact_title}
                      </div>
                    )}
                  </Td>
                  <Td className="text-dakar-muted">{lead.email ?? "—"}</Td>
                  <Td>
                    <select
                      value={lead.status}
                      onChange={(e) =>
                        void updateStatus(lead.id, e.target.value as LeadStatus)
                      }
                      className="appearance-none border-0 bg-transparent p-0 text-inherit outline-none"
                      aria-label="Change status"
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s} className="bg-dakar-surface">
                          {s}
                        </option>
                      ))}
                    </select>
                    <div className="-mt-5 inline-block">
                      <StatusBadge status={lead.status} />
                    </div>
                  </Td>
                  <Td>{lead.confidence_score ?? "—"}</Td>
                  <Td className="text-dakar-muted">
                    {relativeTime(lead.last_contact_at)}
                  </Td>
                  <Td className="text-dakar-muted">
                    {lead.day4_sent_at ? "✓" : "—"}
                  </Td>
                  <Td className="text-dakar-muted">
                    {lead.day9_sent_at ? "✓" : "—"}
                  </Td>
                  <Td className="max-w-[220px] truncate text-dakar-muted">
                    <span title={lead.notes ?? ""}>
                      {lead.notes
                        ? lead.notes.slice(0, 80) + (lead.notes.length > 80 ? "…" : "")
                        : "—"}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => void togglePause(lead)}
                        title={lead.status === "paused" ? "Resume" : "Pause"}
                        className="rounded px-2 py-1 text-xs hover:bg-dakar-purple/15"
                      >
                        {lead.status === "paused" ? "▶️" : "⏸️"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteLead(lead.id)}
                        title="Delete"
                        className="rounded px-2 py-1 text-xs hover:bg-dakar-error/15"
                      >
                        🗑️
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <AddLeadModal
          token={token}
          onClose={() => setShowModal(false)}
          onCreated={() => void refresh()}
        />
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }): JSX.Element {
  return <th className="px-3 py-2 text-left">{children}</th>;
}
function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  return <td className={"px-3 py-2 align-top " + (className ?? "")}>{children}</td>;
}
