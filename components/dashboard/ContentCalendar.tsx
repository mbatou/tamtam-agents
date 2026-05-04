"use client";

import { useCallback, useEffect, useState } from "react";
import { StatusBadge } from "./StatusBadge";
import { useToast } from "./Toast";
import { relativeTime } from "./relativeTime";
import type { Post, PostStatus } from "@/types";

const REFRESH_INTERVAL_MS = 30_000;

const SCHEDULED_STATUSES: ReadonlyArray<PostStatus> = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "scheduled",
  "failed",
];

export function ContentCalendar({ token }: { token: string }): JSX.Element {
  const [tab, setTab] = useState<"scheduled" | "published">("scheduled");
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewPost, setPreviewPost] = useState<Post | null>(null);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/dashboard/content?token=${encodeURIComponent(token)}`,
      );
      if (!res.ok) {
        toast.push("Content refresh failed", "error");
        return;
      }
      const data = (await res.json()) as { rows: Post[] };
      setPosts(data.rows);
    } catch {
      toast.push("Content refresh failed", "error");
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
    tab === "scheduled"
      ? posts.filter((p) => SCHEDULED_STATUSES.includes(p.status))
      : posts.filter((p) => p.status === "published");

  const setStatus = async (
    postId: string,
    status: PostStatus,
  ): Promise<void> => {
    try {
      const res = await fetch(
        `/api/dashboard/content/${postId}?token=${encodeURIComponent(token)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.push(`Post → ${status}`, "success");
      await refresh();
    } catch (err) {
      toast.push(
        `Update failed: ${err instanceof Error ? err.message : "unknown"}`,
        "error",
      );
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["scheduled", "published"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={
              "rounded-md border px-3 py-1.5 text-xs font-medium capitalize transition " +
              (tab === t
                ? "border-dakar-orange bg-dakar-orange/10 text-dakar-orange"
                : "border-dakar-border bg-dakar-surface text-dakar-muted hover:text-dakar-text")
            }
          >
            {t}
          </button>
        ))}
      </div>

      {loading && filtered.length === 0 ? (
        <div className="h-48 animate-pulse rounded-lg border border-dakar-border bg-dakar-surface" />
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dakar-border bg-dakar-surface p-12 text-center text-sm text-dakar-muted">
          {tab === "scheduled"
            ? "No scheduled posts — Awa hasn't drafted anything yet ✨"
            : "Nothing published yet."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-dakar-border">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead className="bg-dakar-surface text-[0.65rem] uppercase tracking-wider text-dakar-muted">
              <tr>
                <th className="px-3 py-2 text-left">Platform</th>
                <th className="px-3 py-2 text-left">Caption preview</th>
                <th className="px-3 py-2 text-left">Status</th>
                {tab === "published" ? (
                  <>
                    <th className="px-3 py-2 text-left">Post id</th>
                    <th className="px-3 py-2 text-left">Published</th>
                  </>
                ) : (
                  <th className="px-3 py-2 text-left">Created</th>
                )}
                <th className="px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  className="border-t border-dakar-border bg-dakar-bg/40 hover:bg-dakar-surface"
                >
                  <td className="px-3 py-2 capitalize text-dakar-text">
                    {p.platform}
                  </td>
                  <td className="px-3 py-2 max-w-[320px] text-dakar-muted">
                    {p.caption.slice(0, 50)}
                    {p.caption.length > 50 ? "…" : ""}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={p.status} />
                  </td>
                  {tab === "published" ? (
                    <>
                      <td className="px-3 py-2 text-xs text-dakar-muted">
                        {p.post_id ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-dakar-muted">
                        {relativeTime(p.scheduled_at ?? p.created_at)}
                      </td>
                    </>
                  ) : (
                    <td className="px-3 py-2 text-dakar-muted">
                      {relativeTime(p.created_at)}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      {tab === "scheduled" && p.status !== "approved" && (
                        <button
                          type="button"
                          onClick={() => void setStatus(p.id, "approved")}
                          title="Approve"
                          className="rounded px-2 py-1 text-xs hover:bg-emerald-500/15"
                        >
                          ✅
                        </button>
                      )}
                      {tab === "scheduled" && p.status !== "rejected" && (
                        <button
                          type="button"
                          onClick={() => void setStatus(p.id, "rejected")}
                          title="Reject"
                          className="rounded px-2 py-1 text-xs hover:bg-dakar-error/15"
                        >
                          ❌
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setPreviewPost(p)}
                        title="View"
                        className="rounded px-2 py-1 text-xs hover:bg-dakar-orange/15"
                      >
                        👁️
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {previewPost && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-lg border border-dakar-border bg-dakar-surface p-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-dakar-text">
                  Post preview
                </h3>
                <div className="mt-1 text-xs text-dakar-muted">
                  {previewPost.platform} · {relativeTime(previewPost.created_at)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewPost(null)}
                className="text-dakar-muted hover:text-dakar-text"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <div className="text-[0.65rem] uppercase tracking-[0.15em] text-dakar-muted">
                  Caption
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-dakar-text">
                  {previewPost.caption}
                </p>
              </div>
              {previewPost.image_prompt && (
                <div>
                  <div className="text-[0.65rem] uppercase tracking-[0.15em] text-dakar-muted">
                    Image prompt
                  </div>
                  <p className="mt-1 text-sm text-dakar-muted">
                    {previewPost.image_prompt}
                  </p>
                </div>
              )}
              {previewPost.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewPost.image_url}
                  alt="Post image"
                  className="max-h-80 rounded-md border border-dakar-border"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
