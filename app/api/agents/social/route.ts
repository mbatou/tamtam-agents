/**
 * Manual trigger endpoint for the Social agent.
 *
 * Used by Georges (or an internal admin tool) to kick off a Social run
 * outside the normal cron / Slack-mention path.
 */

import { NextResponse } from "next/server";
import { MissingEnvError, validateEnv } from "@/lib/env";
import { inngest } from "@/lib/inngest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    validateEnv();
  } catch (err) {
    if (err instanceof MissingEnvError) {
      return NextResponse.json(
        { ok: false, error: "missing_env", missing: err.missing },
        { status: 500 },
      );
    }
    throw err;
  }

  const body = (await req.json().catch(() => ({}))) as { brief?: string };

  const ids = await inngest.send({
    name: "tamtam/social.run",
    data: { trigger: "manual", brief: body.brief },
  });

  return NextResponse.json({ ok: true, eventIds: ids.ids });
}
