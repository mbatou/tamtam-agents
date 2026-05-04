import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isAuthorisedDashboardRequest } from "@/lib/dashboard-auth";
import type { AgentName } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_AGENTS: ReadonlyArray<AgentName> = ["social", "growth", "coo"];

const ALLOWED_FIELDS = new Set([
  "focus_this_week",
  "tone",
  "post_frequency",
  "daily_lead_target",
  "apollo_monthly_budget",
  "icp_focus",
  "outreach_day4",
  "outreach_day9",
  "standup_time",
  "brief_frequency",
  "babacar_reminder",
  "is_active",
]);

export async function PATCH(
  req: Request,
  { params }: { params: { agent: string } },
): Promise<Response> {
  if (!isAuthorisedDashboardRequest(req)) {
    return new NextResponse("not found", { status: 404 });
  }

  if (!VALID_AGENTS.includes(params.agent as AgentName)) {
    return NextResponse.json(
      { error: `invalid agent: ${params.agent}` },
      { status: 400 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (ALLOWED_FIELDS.has(key)) update[key] = value;
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "no patchable fields supplied" },
      { status: 400 },
    );
  }

  const { data, error } = await getSupabaseAdmin()
    .from("agent_settings")
    .update(update as never)
    .eq("agent", params.agent as AgentName)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ settings: data });
}
