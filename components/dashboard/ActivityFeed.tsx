"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentBadge, getAgentMeta } from "./AgentBadge";
import { relativeTime } from "./relativeTime";
import { useToast } from "./Toast";
import type { AgentLog, AgentName } from "@/types";

const REFRESH_INTERVAL_MS = 30_000;

export function ActivityFeed({ token }: { token: string }): JSX.Element {
  const [rows, setRows] = useState<AgentLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<AgentName | "all">("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboard/feed?token=${encodeURIComponent(token)}`);
      if (!res.ok) {
        toast.push("Feed refresh failed", "error");
        return;
      }
      const data = (await res.json()) as { rows: AgentLog[] };
      setRows(data.rows);
      setLastRefresh(new Date());
    } catch {
      toast.push("Feed refresh failed", "error");
    } finally {
      setLoading(false);
    }
  }, [token, toast]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const filtered =
    filter === "all" ? rows : rows.filter((r) => r.agent === filter);

  const toggleExpand = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(["all", "social", "growth", "coo"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={
                "rounded-md border px-3 py-1.5 text-xs font-medium transition " +
                (filter === key
                  ? "border-dakar-orange bg-dakar-orange/10 text-dakar-orange"
                  : "border-dakar-border bg-dakar-surface text-dakar-muted hover:text-dakar-text")
              }
            >
              {key === "all" ? "All" : `${getAgentMeta(key).emoji} ${getAgentMeta(key).name}`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-xs text-dakar-muted">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 animate-pulse rounded-full bg-dakar-teal" />
            Live
          </span>
          {lastRefresh && (
            <span>last refresh: {relativeTime(lastRefresh)}</span>
          )}
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <FeedSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState
          message={
            filter === "all"
              ? "No activity yet — agents are warming up 🥁"
              : `No recent activity for ${getAgentMeta(filter).name}.`
          }
        />
      ) : (
        <ul className="space-y-2">
          {filtered.map((row) => {
            const isOpen = expanded.has(row.id);
            return (
              <li
                key={row.id}
                className="rounded-lg border border-dakar-border bg-dakar-surface p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <AgentBadge agent={row.agent} />
                    <span className="text-xs text-dakar-muted">
                      · {relativeTime(row.created_at)}
                    </span>
                  </div>
                  <span
                    className={
                      "text-xs uppercase tracking-wide " +
                      (row.status === "failed"
                        ? "text-dakar-error"
                        : row.status === "skipped"
                          ? "text-dakar-muted"
                          : "text-dakar-teal")
                    }
                  >
                    {row.status}
                  </span>
                </div>
                <div className="mt-2 text-sm text-dakar-text">
                  <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs text-dakar-muted">
                    {row.action}
                  </code>
                </div>
                <button
                  type="button"
                  onClick={() => toggleExpand(row.id)}
                  className="mt-2 text-xs text-dakar-muted underline-offset-2 hover:text-dakar-orange hover:underline"
                >
                  {isOpen ? "Hide metadata" : "Show metadata"}
                </button>
                {isOpen && (
                  <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-black/40 p-3 text-xs text-dakar-muted">
                    {JSON.stringify(row.metadata, null, 2)}
                  </pre>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function FeedSkeleton(): JSX.Element {
  return (
    <ul className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <li
          key={i}
          className="h-20 animate-pulse rounded-lg border border-dakar-border bg-dakar-surface"
        />
      ))}
    </ul>
  );
}

function EmptyState({ message }: { message: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-dakar-border bg-dakar-surface p-12 text-center text-sm text-dakar-muted">
      {message}
    </div>
  );
}
