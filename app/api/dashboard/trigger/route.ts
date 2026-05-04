/**
 * Trigger endpoint for the dashboard's "▶ Trigger ..." buttons.
 *
 * Maps a dashboard-friendly { agent, action } payload to a real
 * Inngest event name. The .mentioned events require Slack-context
 * fields and are NOT exposed here — manual triggers use the
 * dedicated .run / .tick / cron-mirror events instead. Both shapes
 * fire the same downstream pipeline.
 */

import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest";
import { isAuthorisedDashboardRequest } from "@/lib/dashboard-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TriggerBody {
  agent: "social" | "growth" | "coo";
  action: "post" | "prospecting" | "standup" | "brief" | "wrapup";
}

type TriggerKey = `${TriggerBody["agent"]}.${TriggerBody["action"]}`;

interface TriggerSpec {
  name: string;
  data: Record<string, unknown>;
  /** Optional descriptive id-prefix for Inngest dedup. */
  idPrefix?: string;
}

const TRIGGER_MAP: Partial<Record<TriggerKey, TriggerSpec>> = {
  "growth.prospecting": {
    name: "tamtam/kofi.prospecting",
    data: { trigger: "manual" },
    idPrefix: "dashboard-prospecting",
  },
  "coo.standup": {
    name: "tamtam/team.standup",
    data: { trigger: "manual" },
    idPrefix: "dashboard-standup",
  },
  // The dashboard says `coo + brief → tamtam/coo.mentioned`, but
  // .mentioned needs Slack channel/user/text fields. .tick is the
  // event the COO function listens to for cron + manual paths and
  // produces the same brief.
  "coo.brief": {
    name: "tamtam/coo.tick",
    data: { trigger: "manual" },
    idPrefix: "dashboard-brief",
  },
  "coo.wrapup": {
    name: "tamtam/team.friday-wrapup",
    data: { trigger: "manual" },
    idPrefix: "dashboard-wrapup",
  },
  // Same reasoning: .run is the manual-trigger event for Awa's
  // post-generation flow; .mentioned is reserved for real Slack
  // mentions.
  "social.post": {
    name: "tamtam/social.run",
    data: { trigger: "manual" },
    idPrefix: "dashboard-post",
  },
};

export async function POST(req: Request): Promise<Response> {
  if (!isAuthorisedDashboardRequest(req)) {
    return new NextResponse("not found", { status: 404 });
  }

  let body: TriggerBody;
  try {
    body = (await req.json()) as TriggerBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.agent || !body.action) {
    return NextResponse.json(
      { error: "agent and action are required" },
      { status: 400 },
    );
  }

  const key = `${body.agent}.${body.action}` as TriggerKey;
  const spec = TRIGGER_MAP[key];
  if (!spec) {
    return NextResponse.json(
      { error: `unknown trigger: ${key}` },
      { status: 400 },
    );
  }

  const id = `${spec.idPrefix ?? "dashboard"}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const ids = await inngest.send({
    id,
    name: spec.name,
    data: spec.data,
  } as never);

  return NextResponse.json({
    ok: true,
    triggered: spec.name,
    inngest_event_id: id,
    ids,
  });
}
