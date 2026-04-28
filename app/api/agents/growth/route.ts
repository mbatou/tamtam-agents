/**
 * Manual trigger endpoint for the Growth agent.
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

  const body = (await req.json().catch(() => ({}))) as { lead_id?: string };

  const ids = await inngest.send({
    name: "tamtam/growth.run",
    data: { trigger: "manual", lead_id: body.lead_id },
  });

  return NextResponse.json({ ok: true, eventIds: ids.ids });
}
