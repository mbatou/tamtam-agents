/**
 * Manual trigger endpoint for the Growth agent.
 */

import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  // TODO(session-2): require an admin token header (TAMTAM_ADMIN_TOKEN)
  const body = (await req.json().catch(() => ({}))) as { lead_id?: string };

  const ids = await inngest.send({
    name: "agents/growth.run",
    data: { trigger: "manual", lead_id: body.lead_id },
  });

  return NextResponse.json({ ok: true, eventIds: ids.ids });
}
