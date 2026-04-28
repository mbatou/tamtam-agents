/**
 * Manual trigger endpoint for the Social agent.
 *
 * Used by Georges (or an internal admin tool) to kick off a Social run
 * outside the normal cron / Slack-mention path. Authenticated by a
 * shared secret header to prevent the public web from invoking it.
 */

import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  // TODO(session-2): require an admin token header (TAMTAM_ADMIN_TOKEN)
  const body = (await req.json().catch(() => ({}))) as { brief?: string };

  const ids = await inngest.send({
    name: "agents/social.run",
    data: { trigger: "manual", brief: body.brief },
  });

  return NextResponse.json({ ok: true, eventIds: ids.ids });
}
