/**
 * Slack Events API endpoint.
 *
 * Verifies the Slack signing secret on every request, handles the
 * one-time `url_verification` challenge, and dispatches `event_callback`
 * payloads to agent handlers (Session 2).
 */

import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verifySlackSignature } from "@/lib/slack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const ok = verifySlackSignature({
    signingSecret: env.SLACK_SIGNING_SECRET,
    rawBody,
    timestamp: req.headers.get("x-slack-request-timestamp"),
    signature: req.headers.get("x-slack-signature"),
  });
  if (!ok) {
    return new NextResponse("invalid signature", { status: 401 });
  }

  let payload: { type?: string; challenge?: string; event?: { type: string } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse("invalid json", { status: 400 });
  }

  // Slack URL verification handshake.
  if (payload.type === "url_verification" && payload.challenge) {
    return NextResponse.json({ challenge: payload.challenge });
  }

  if (payload.type === "event_callback" && payload.event) {
    // TODO(session-2): route by event.type to agent handlers
    //   - "app_mention"        -> determine which @persona was tagged
    //   - "message.im"         -> direct message to the bot
    //   - dispatch via inngest.send({ name: "agents/<x>.run", data: ... })
    return NextResponse.json({ ok: true, received: payload.event.type });
  }

  return NextResponse.json({ ok: true });
}
