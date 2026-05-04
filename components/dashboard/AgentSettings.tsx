"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "./Toast";
import { getAgentMeta } from "./AgentBadge";
import type { AgentName, AgentSettings as AgentSettingsRow } from "@/types";

interface TriggerSpec {
  label: string;
  agent: AgentName;
  action: "post" | "prospecting" | "standup" | "brief" | "wrapup";
}

const TRIGGERS: Record<AgentName, ReadonlyArray<TriggerSpec>> = {
  social: [{ label: "▶ Trigger post", agent: "social", action: "post" }],
  growth: [
    { label: "▶ Trigger prospecting now", agent: "growth", action: "prospecting" },
  ],
  coo: [
    { label: "▶ Trigger standup now", agent: "coo", action: "standup" },
    { label: "▶ Trigger brief now", agent: "coo", action: "brief" },
    { label: "▶ Trigger Friday wrap-up", agent: "coo", action: "wrapup" },
  ],
};

const ROLE_LABEL: Record<AgentName, string> = {
  social: "Social Media Lead",
  growth: "Growth & Sales Lead",
  coo: "COO",
};

export function AgentSettingsCards({
  token,
}: {
  token: string;
}): JSX.Element {
  const [rows, setRows] = useState<AgentSettingsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/dashboard/settings?token=${encodeURIComponent(token)}`,
      );
      if (!res.ok) {
        toast.push("Settings load failed", "error");
        return;
      }
      const data = (await res.json()) as { rows: AgentSettingsRow[] };
      setRows(data.rows);
    } catch {
      toast.push("Settings load failed", "error");
    } finally {
      setLoading(false);
    }
  }, [token, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const byAgent = useMemo(() => {
    const out: Partial<Record<AgentName, AgentSettingsRow>> = {};
    for (const r of rows) out[r.agent] = r;
    return out;
  }, [rows]);

  if (loading) {
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-72 animate-pulse rounded-lg border border-dakar-border bg-dakar-surface"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {(["social", "growth", "coo"] as AgentName[]).map((agent) => {
        const settings = byAgent[agent];
        if (!settings) {
          return (
            <Card key={agent} agent={agent}>
              <p className="text-sm text-dakar-muted">
                No settings row for {agent}. Run migration 0003.
              </p>
            </Card>
          );
        }
        return (
          <SettingsCard
            key={agent}
            token={token}
            settings={settings}
            onSaved={() => void refresh()}
          />
        );
      })}
    </div>
  );
}

function SettingsCard({
  token,
  settings,
  onSaved,
}: {
  token: string;
  settings: AgentSettingsRow;
  onSaved: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState<AgentSettingsRow>(settings);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  // If parent re-fetches, reset the draft.
  useEffect(() => setDraft(settings), [settings]);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/dashboard/settings/${draft.agent}?token=${encodeURIComponent(token)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            focus_this_week: draft.focus_this_week,
            tone: draft.tone,
            post_frequency: draft.post_frequency,
            daily_lead_target: draft.daily_lead_target,
            apollo_monthly_budget: draft.apollo_monthly_budget,
            icp_focus: draft.icp_focus,
            outreach_day4: draft.outreach_day4,
            outreach_day9: draft.outreach_day9,
            standup_time: draft.standup_time,
            brief_frequency: draft.brief_frequency,
            babacar_reminder: draft.babacar_reminder,
            is_active: draft.is_active,
          }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.push("Saved", "success");
      onSaved();
    } catch (err) {
      toast.push(
        `Save failed: ${err instanceof Error ? err.message : "unknown"}`,
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const trigger = async (spec: TriggerSpec): Promise<void> => {
    try {
      const res = await fetch(
        `/api/dashboard/trigger?token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent: spec.agent, action: spec.action }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.push(`Triggered ✅ (${spec.action})`, "success");
    } catch (err) {
      toast.push(
        `Trigger failed: ${err instanceof Error ? err.message : "unknown"}`,
        "error",
      );
    }
  };

  return (
    <Card agent={draft.agent}>
      <div className="space-y-3">
        {draft.agent === "social" && (
          <>
            <Field label="Focus this week">
              <textarea
                value={draft.focus_this_week ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, focus_this_week: e.target.value })
                }
                rows={2}
                className={inputCls}
              />
            </Field>
            <Field label="Tone">
              <select
                value={draft.tone}
                onChange={(e) => setDraft({ ...draft, tone: e.target.value })}
                className={inputCls}
              >
                <option value="warm">Warm</option>
                <option value="professional">Professional</option>
                <option value="bold">Bold</option>
              </select>
            </Field>
            <Field label="Post frequency">
              <select
                value={draft.post_frequency}
                onChange={(e) =>
                  setDraft({ ...draft, post_frequency: e.target.value })
                }
                className={inputCls}
              >
                <option value="daily">Daily</option>
                <option value="3x_week">3× per week</option>
                <option value="weekly">Weekly</option>
              </select>
            </Field>
          </>
        )}

        {draft.agent === "growth" && (
          <>
            <Field label="Daily lead target">
              <input
                type="number"
                min={0}
                value={draft.daily_lead_target}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    daily_lead_target: Number(e.target.value),
                  })
                }
                className={inputCls}
              />
            </Field>
            <Field label="Apollo budget / month">
              <input
                type="number"
                min={0}
                value={draft.apollo_monthly_budget}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    apollo_monthly_budget: Number(e.target.value),
                  })
                }
                className={inputCls}
              />
            </Field>
            <Field label="ICP focus">
              <textarea
                value={draft.icp_focus}
                onChange={(e) =>
                  setDraft({ ...draft, icp_focus: e.target.value })
                }
                rows={2}
                className={inputCls}
              />
            </Field>
            <Field label="Follow-up cadence (days)">
              <div className="flex items-center gap-2">
                <span className="text-xs text-dakar-muted">Day</span>
                <input
                  type="number"
                  min={1}
                  value={draft.outreach_day4}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      outreach_day4: Number(e.target.value),
                    })
                  }
                  className={inputCls + " w-20"}
                />
                <span className="text-xs text-dakar-muted">then Day</span>
                <input
                  type="number"
                  min={1}
                  value={draft.outreach_day9}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      outreach_day9: Number(e.target.value),
                    })
                  }
                  className={inputCls + " w-20"}
                />
              </div>
            </Field>
          </>
        )}

        {draft.agent === "coo" && (
          <>
            <Field label="Standup time (WAT)">
              <input
                type="time"
                value={draft.standup_time}
                onChange={(e) =>
                  setDraft({ ...draft, standup_time: e.target.value })
                }
                className={inputCls}
              />
            </Field>
            <Field label="Brief frequency">
              <select
                value={draft.brief_frequency}
                onChange={(e) =>
                  setDraft({ ...draft, brief_frequency: e.target.value })
                }
                className={inputCls}
              >
                <option value="every_4h">Every 4 hours</option>
                <option value="every_8h">Every 8 hours</option>
                <option value="daily">Daily</option>
              </select>
            </Field>
            <Field label="Babacar SAS reminder">
              <button
                type="button"
                onClick={() =>
                  setDraft({ ...draft, babacar_reminder: !draft.babacar_reminder })
                }
                className={
                  "rounded-full px-3 py-1 text-xs font-medium transition " +
                  (draft.babacar_reminder
                    ? "bg-dakar-teal/20 text-dakar-teal"
                    : "bg-dakar-border text-dakar-muted")
                }
              >
                {draft.babacar_reminder ? "ON" : "OFF"}
              </button>
            </Field>
          </>
        )}

        <div className="pt-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-md bg-dakar-orange px-3 py-1.5 text-xs font-medium text-white hover:bg-dakar-orange/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>

        <div className="space-y-1 border-t border-dakar-border pt-3">
          {TRIGGERS[draft.agent].map((spec) => (
            <button
              key={spec.action}
              type="button"
              onClick={() => void trigger(spec)}
              className="w-full rounded-md border border-dakar-border bg-dakar-bg px-3 py-1.5 text-left text-xs text-dakar-text hover:border-dakar-orange hover:text-dakar-orange"
            >
              {spec.label}
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}

function Card({
  agent,
  children,
}: {
  agent: AgentName;
  children: React.ReactNode;
}): JSX.Element {
  const meta = getAgentMeta(agent);
  return (
    <div className="rounded-lg border border-dakar-border bg-dakar-surface p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold text-dakar-text">
            <span className="mr-2">{meta.emoji}</span>
            {meta.name === "Awa"
              ? "Awa Diallo"
              : meta.name === "Kofi"
                ? "Kofi Mensah"
                : "Rama Sall"}
          </div>
          <div className="text-xs text-dakar-muted">{ROLE_LABEL[agent]}</div>
        </div>
        <span className="inline-flex items-center gap-1 text-xs text-dakar-teal">
          <span className="h-2 w-2 rounded-full bg-dakar-teal" />
          Active
        </span>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-[0.65rem] uppercase tracking-[0.15em] text-dakar-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-md border border-dakar-border bg-dakar-bg px-3 py-2 text-sm text-dakar-text outline-none focus:border-dakar-orange";
