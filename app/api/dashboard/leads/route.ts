import { NextResponse } from "next/server";
import { getSupabaseAdmin, upsertLead } from "@/lib/supabase";
import { isAuthorisedDashboardRequest } from "@/lib/dashboard-auth";
import type { Lead, LeadStatus } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!isAuthorisedDashboardRequest(req)) {
    return new NextResponse("not found", { status: 404 });
  }

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status");
  const sourceFilter = url.searchParams.get("source");
  const search = url.searchParams.get("q");

  let query = getSupabaseAdmin()
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false });

  if (statusFilter && statusFilter !== "all") {
    query = query.eq("status", statusFilter as LeadStatus);
  }
  if (search && search.length > 0) {
    // ILIKE on company OR email — Supabase supports `or` filters
    // with a comma-separated string of conditions.
    query = query.or(
      `company.ilike.%${search}%,email.ilike.%${search}%`,
    );
  }

  const { data, error } = await query.limit(500);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let rows = (data ?? []) as unknown as Lead[];

  // Source filter is post-hoc because we encode source in `notes`,
  // not as a column. Cheap given the LIMIT 500 cap.
  if (sourceFilter && sourceFilter !== "all") {
    const needle =
      sourceFilter === "apollo"
        ? "apollo"
        : sourceFilter === "manual"
          ? "manual_georges"
          : sourceFilter === "claude"
            ? "claude_research"
            : "";
    if (needle) {
      rows = rows.filter((r) =>
        (r.notes ?? "").toLowerCase().includes(needle),
      );
    }
  }

  // Pipeline-stats summary alongside the rows.
  const counts: Record<LeadStatus | "total", number> = {
    total: rows.length,
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
  };
  for (const r of rows) counts[r.status] += 1;

  // Apollo credit counter for the StatsBar.
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { count: apolloUsed } = await getSupabaseAdmin()
    .from("agent_logs")
    .select("id", { count: "exact", head: true })
    .eq("agent", "growth")
    .eq("action", "apollo.credit_used")
    .gte("created_at", monthStart.toISOString());

  return NextResponse.json({
    rows,
    counts,
    apollo: {
      used: apolloUsed ?? 0,
      budget: 75,
    },
  });
}

interface CreateLeadBody {
  company: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  notes?: string;
}

export async function POST(req: Request): Promise<Response> {
  if (!isAuthorisedDashboardRequest(req)) {
    return new NextResponse("not found", { status: 404 });
  }

  let body: CreateLeadBody;
  try {
    body = (await req.json()) as CreateLeadBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.company || body.company.trim().length === 0) {
    return NextResponse.json(
      { error: "company is required" },
      { status: 400 },
    );
  }

  const lead = await upsertLead({
    company: body.company.trim(),
    contact_name: body.contact_name?.trim() ?? null,
    email: body.email?.trim() ?? null,
    status: "researched",
    intent_signal: "dashboard_manual_entry",
    confidence_score: 90,
    awa_warmup: false,
    outreach_channel: body.email ? "email" : null,
    why_now: "Manual dashboard entry",
    notes:
      `Source: dashboard_manual (${new Date().toISOString()}).` +
      (body.phone ? `\nPhone: ${body.phone}` : "") +
      (body.notes ? `\n${body.notes}` : ""),
  });

  return NextResponse.json({ lead });
}
