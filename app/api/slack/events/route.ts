/**
 * Slack Events API endpoint.
 *
 * Responsibilities, in order:
 *   1. Verify the Slack signing secret on every request (5-min replay window).
 *   2. Handle the one-time `url_verification` challenge.
 *   3. Parse `event_callback` payloads and route by event type.
 *   4. For `app_mention`: detect which agent was tagged, emit the matching
 *      Inngest event, and ACK with 200 immediately. ALL real work happens
 *      asynchronously inside the Inngest function — the route returns in
 *      well under Slack's 3-second timeout.
 *   5. Validate env on every request (cheap; surfaces misconfiguration loudly).
 */

import { NextResponse } from "next/server";
import { env, validateEnv, MissingEnvError } from "@/lib/env";
import {
  detectAgentFromMention,
  verifySlackSignature,
} from "@/lib/slack";
import { inngest } from "@/lib/inngest";
import { logAgentAction } from "@/lib/supabase";
import type { AgentName } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SlackUrlVerification {
  type: "url_verification";
  challenge: string;
  token?: string;
}

interface SlackAppMentionEvent {
  type: "app_mention";
  user: string;
  text: string;
  ts: string;
  channel: string;
  event_ts: string;
  thread_ts?: string;
}

interface SlackEventCallback {
  type: "event_callback";
  event_id: string;
  event_time: number;
  event: SlackAppMentionEvent | { type: string };
}

type SlackPayload = SlackUrlVerification | SlackEventCallback;

const MENTION_EVENT_NAME: Record<AgentName, "tamtam/social.mentioned" | "tamtam/growth.mentioned" | "tamtam/coo.mentioned"> = {
  social: "tamtam/social.mentioned",
  growth: "tamtam/growth.mentioned",
  coo: "tamtam/coo.mentioned",
};

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

  let payload: SlackPayload;
  try {
    payload = JSON.parse(rawBody) as SlackPayload;
  } catch {
    return new NextResponse("invalid json", { status: 400 });
  }

  // Slack URL verification handshake — must echo `challenge` back.
  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge });
  }

  if (payload.type !== "event_callback") {
    return NextResponse.json({ ok: true, ignored: "non_event_callback" });
  }

  const event = payload.event;
  if (event.type !== "app_mention") {
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  const mention = event as SlackAppMentionEvent;
  const agent = detectAgentFromMention(mention.text);
  if (!agent) {
    return NextResponse.json({ ok: true, ignored: "unrecognized_agent" });
  }

  // Fire-and-ack: emit the Inngest event and return immediately. Logging
  // also goes through Inngest's pipeline implicitly via the agent runner,
  // but we record receipt here too so /api/slack/events ↔ agent runs are
  // traceable end-to-end.
  await Promise.all([
    inngest.send({
      name: MENTION_EVENT_NAME[agent],
      data: {
        text: mention.text,
        channel: mention.channel,
        user: mention.user,
        thread_ts: mention.thread_ts,
        event_ts: mention.event_ts,
      },
    }),
    logAgentAction({
      agent,
      action: "slack.mention.received",
      metadata: {
        channel: mention.channel,
        user: mention.user,
        ts: mention.event_ts,
      },
      status: "started",
    }).catch(() => undefined), // never let logging failures block ACK
  ]);

  return NextResponse.json({ ok: true, dispatched: agent });
}
