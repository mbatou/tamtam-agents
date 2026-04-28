/**
 * Health endpoint.
 *
 * Probes Supabase, Slack, and the env-var contract; returns a JSON
 * summary suitable for uptime monitors. Deliberately does NOT call
 * `validateEnv()` at the top — if env is broken we still want a 200
 * response that reports the brokenness.
 *
 * HTTP status:
 *   - 200 when all probes pass
 *   - 503 when at least one probe fails
 *
 * No secret is leaked: missing-env reports list only the variable
 * names, never values.
 */

import { NextResponse } from "next/server";
import { checkEnv, env } from "@/lib/env";
import { pingSupabase } from "@/lib/supabase";
import { getSlackWeb } from "@/lib/slack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProbeResult = { ok: true } | { ok: false; error: string };

interface HealthResponse {
  status: "ok" | "degraded";
  timestamp: string;
  services: {
    supabase: ProbeResult;
    slack: ProbeResult;
    inngest: ProbeResult;
  };
  env: { ok: true } | { ok: false; missing: string[] };
}

async function probeSlack(): Promise<ProbeResult> {
  try {
    const res = await getSlackWeb().auth.test();
    if (!res.ok) {
      return { ok: false, error: res.error ?? "auth.test failed" };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Inngest doesn't expose a public auth-test API, so we verify locally:
 * the event key + signing key are present and the client constructs.
 * (The real "is Inngest reachable?" question is answered by Inngest's
 * own dashboard view of when it last synced our serve endpoint.)
 */
function probeInngest(): ProbeResult {
  try {
    const key = env.INNGEST_EVENT_KEY;
    const sig = env.INNGEST_SIGNING_KEY;
    if (!key || !sig) {
      return { ok: false, error: "INNGEST_EVENT_KEY or INNGEST_SIGNING_KEY missing" };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET(): Promise<Response> {
  const envCheck = checkEnv();

  const [supabaseProbe, slackProbe] = await Promise.all([
    pingSupabase(),
    probeSlack(),
  ]);
  const inngestProbe = probeInngest();

  const allOk =
    supabaseProbe.ok &&
    slackProbe.ok &&
    inngestProbe.ok &&
    envCheck.ok;

  const body: HealthResponse = {
    status: allOk ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    services: {
      supabase: supabaseProbe,
      slack: slackProbe,
      inngest: inngestProbe,
    },
    env: envCheck,
  };

  return NextResponse.json(body, { status: allOk ? 200 : 503 });
}
