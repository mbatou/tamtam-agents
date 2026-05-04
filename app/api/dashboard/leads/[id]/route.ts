import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isAuthorisedDashboardRequest } from "@/lib/dashboard-auth";
import type { LeadStatus } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_FIELDS = new Set([
  "company",
  "contact_name",
  "contact_title",
  "email",
  "status",
  "notes",
]);

const ALLOWED_STATUSES: ReadonlyArray<LeadStatus> = [
  "new",
  "researching",
  "researched",
  "queued",
  "contacted",
  "warm",
  "hot",
  "replied",
  "cold",
  "rejected",
  "paused",
  "converted",
  "won",
  "lost",
  "do_not_contact",
];

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  if (!isAuthorisedDashboardRequest(req)) {
    return new NextResponse("not found", { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Whitelist the patchable fields — never let the dashboard write
  // arbitrary columns (e.g. confidence_score, escalated_to_georges).
  const update: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (ALLOWED_FIELDS.has(key)) update[key] = value;
  }

  if (
    typeof update.status === "string" &&
    !ALLOWED_STATUSES.includes(update.status as LeadStatus)
  ) {
    return NextResponse.json(
      { error: `invalid status: ${update.status}` },
      { status: 400 },
    );
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "no patchable fields supplied" },
      { status: 400 },
    );
  }

  const { data, error } = await getSupabaseAdmin()
    .from("leads")
    .update(update as never)
    .eq("id", params.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ lead: data });
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  if (!isAuthorisedDashboardRequest(req)) {
    return new NextResponse("not found", { status: 404 });
  }

  const { error } = await getSupabaseAdmin()
    .from("leads")
    .delete()
    .eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
