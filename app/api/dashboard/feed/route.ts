import { NextResponse } from "next/server";
import {
  getSupabaseAdmin,
} from "@/lib/supabase";
import { isAuthorisedDashboardRequest } from "@/lib/dashboard-auth";
import type { AgentLog } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FEED_LIMIT = 100;

export async function GET(req: Request): Promise<Response> {
  if (!isAuthorisedDashboardRequest(req)) {
    // 404, never 401 — don't reveal the page exists.
    return new NextResponse("not found", { status: 404 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("agent_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(FEED_LIMIT);

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    rows: (data ?? []) as unknown as AgentLog[],
  });
}
