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
  detectAgentFromChannel,
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
  /** Slack populates this when the source is a bot/integration user. */
  bot_id?: string;
}

interface SlackEventCallback {
  type: "event_callback";
  event_id: string;
  event_time: number;
  event: SlackAppMentionEvent | { type: string; bot_id?: string };
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
  console.log("[slack/events] raw body:", rawBody);

  const ok = verifySlackSignature({
    signingSecret: env.SLACK_SIGNING_SECRET,
    rawBody,
    timestamp: req.headers.get("x-slack-request-timestamp"),
    signature: req.headers.get("x-slack-signature"),
  });
  if (!ok) {
    console.log("[slack/events] signature verification FAILED");
    return new NextResponse("invalid signature", { status: 401 });
  }

  let payload: SlackPayload;
  try {
    payload = JSON.parse(rawBody) as SlackPayload;
  } catch {
    console.log("[slack/events] body is not valid JSON");
    return new NextResponse("invalid json", { status: 400 });
  }

  console.log("[slack/events] event type:", payload.type);

  // Slack URL verification handshake — must echo `challenge` back.
  if (payload.type === "url_verification") {
    console.log("[slack/events] url_verification handshake");
    return NextResponse.json({ challenge: payload.challenge });
  }

  if (payload.type !== "event_callback") {
    // Defensive: TS proves this is unreachable given the union, but the
    // wire format may evolve and we want the gate (and the log) intact.
    console.log("[slack/events] ignored non_event_callback");
    return NextResponse.json({ ok: true, ignored: "non_event_callback" });
  }

  const event = payload.event;
  console.log("[slack/events] event:", JSON.stringify(event));

  // Bot-loop guard. Drop bot-originated events EXCEPT app_mention so we
  // never react to our own messages or to other integrations' chatter.
  // Critical: keep app_mention through this gate, even if Slack stamped
  // a bot_id on it (e.g., a workflow @-mentioned us) — that is a
  // legitimate request to act.
  if (
    "bot_id" in event &&
    event.bot_id &&
    event.type !== "app_mention"
  ) {
    console.log(
      "[slack/events] ignored bot-originated event:",
      event.type,
      "bot_id=",
      event.bot_id,
    );
    return NextResponse.json({ ok: true, ignored: "bot_event" });
  }

  if (event.type !== "app_mention") {
    console.log("[slack/events] ignored event type:", event.type);
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  const mention = event as SlackAppMentionEvent;
  const agent = detectAgentFromChannel(mention.channel);
  console.log(
    "[slack/events] routing by channel:",
    mention.channel,
    "→ agent:",
    agent,
  );

  if (!agent) {
    // The bot was @-mentioned in a channel we don't track (or
    // SLACK_CHANNEL_* env vars hold names instead of channel ids — names
    // are not what Slack puts on the event payload).
    console.log(
      "[slack/events] no agent matched channel — channel was:",
      mention.channel,
      "expected one of:",
      env.SLACK_CHANNEL_SOCIAL,
      env.SLACK_CHANNEL_GROWTH,
      env.SLACK_CHANNEL_COO,
    );
    return NextResponse.json({ ok: true, ignored: "unrecognized_channel" });
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

  console.log("[slack/events] inngest event emitted:", MENTION_EVENT_NAME[agent]);
  return NextResponse.json({ ok: true, dispatched: agent });
}
