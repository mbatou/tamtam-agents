/**
 * Manual trigger endpoint for the COO agent.
 *
 * Useful when Georges wants an on-demand brief outside the cron schedule.
 */

import { NextResponse } from "next/server";
import { MissingEnvError, validateEnv } from "@/lib/env";
import { inngest } from "@/lib/inngest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request): Promise<Response> {
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

  const ids = await inngest.send({
    name: "tamtam/coo.tick",
    data: { trigger: "manual" },
  });
  return NextResponse.json({ ok: true, eventIds: ids.ids });
}
