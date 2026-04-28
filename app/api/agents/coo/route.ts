/**
 * Manual trigger endpoint for the COO agent.
 *
 * Useful when Georges wants an on-demand brief outside the cron schedule.
 */

import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request): Promise<Response> {
  // TODO(session-2): require an admin token header (TAMTAM_ADMIN_TOKEN)
  const ids = await inngest.send({
    name: "agents/coo.tick",
    data: { trigger: "manual" },
  });
  return NextResponse.json({ ok: true, eventIds: ids.ids });
}
