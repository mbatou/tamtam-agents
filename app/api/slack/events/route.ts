/**
 * Slack Events API endpoint.
 *
 * Pipeline (in order):
 *   1. validateEnv()                 — fail fast if Vercel is misconfigured
 *   2. verify Slack signing secret   — 5-minute replay window
 *   3. parse JSON                    — handle url_verification handshake
 *   4. STRICT bot guard              — drop anything with bot_id (loop guard)
 *   5. team-channel branch           — special commands + Georges check-in
 *   6. agent-channel branch          — app_mention → routed by channel id
 *
 * Side effects: emits exactly one Inngest event per request (or zero if
 * the request is ignored). Returns 200 in well under Slack's 3s timeout.
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

/**
 * Common shape across the event types we care about. Slack stamps
 * `bot_id` whenever the source is a bot/integration user — our strict
 * guard drops everything that has it set.
 */
interface SlackInboundEvent {
  type: string;
  user?: string;
  text?: string;
  ts?: string;
  channel?: string;
  event_ts?: string;
  thread_ts?: string;
  bot_id?: string;
  /** Set on edits, deletes, etc. — we ignore those. */
  subtype?: string;
}

interface SlackEventCallback {
  type: "event_callback";
  event_id: string;
  event_time: number;
  event: SlackInboundEvent;
}

type SlackPayload = SlackUrlVerification | SlackEventCallback;

const MENTION_EVENT_NAME: Record<
  AgentName,
  "tamtam/social.mentioned" | "tamtam/growth.mentioned" | "tamtam/coo.mentioned"
> = {
  social: "tamtam/social.mentioned",
  growth: "tamtam/growth.mentioned",
  coo: "tamtam/coo.mentioned",
};

/* -------------------------------------------------------------------------- */
/*  Team-channel command parser                                               */
/* -------------------------------------------------------------------------- */

type TeamCommand =
  | { kind: "standup" }
  | { kind: "wrapup" }
  | { kind: "moment" }
  | { kind: "test_reactions" };

/**
 * Lightweight prefix-match for ops-style commands typed into
 * #tamtam-team. Case-insensitive substring match — Georges can wrap
 * with whatever phrasing he wants ("hey Rama, trigger standup please").
 */
function detectTeamCommand(text: string): TeamCommand | null {
  const lower = text.toLowerCase();
  if (lower.includes("trigger standup")) return { kind: "standup" };
  if (lower.includes("trigger wrapup")) return { kind: "wrapup" };
  if (lower.includes("trigger moment")) return { kind: "moment" };
  if (lower.includes("trigger reactions")) return { kind: "test_reactions" };
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Handler                                                                   */
/* -------------------------------------------------------------------------- */

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
    console.log("[slack/events] ignored non_event_callback");
    return NextResponse.json({ ok: true, ignored: "non_event_callback" });
  }

  const event = payload.event;
  console.log("[slack/events] event:", JSON.stringify(event));

  // STRICT bot guard. Any event from a bot — including bot-originated
  // app_mentions — is dropped. This is the loop guard for #tamtam-team:
  // Awa/Kofi/Rama post there as the bot, those messages carry bot_id,
  // we never react to our own.
  if (event.bot_id) {
    console.log(
      "[slack/events] ignored bot message — bot_id=",
      event.bot_id,
      "type=",
      event.type,
    );
    return NextResponse.json({ ok: true, ignored: "bot_message" });
  }

  // Edits, deletes, etc. — never act on those.
  if (event.subtype) {
    console.log("[slack/events] ignored — subtype:", event.subtype);
    return NextResponse.json({ ok: true, ignored: `subtype_${event.subtype}` });
  }

  const channelId = event.channel ?? "";
  const text = event.text ?? "";

  /* ────────────────────────────────────────────────────────────────────── */
  /*  Branch A: #tamtam-team — special handling                             */
  /* ────────────────────────────────────────────────────────────────────── */

  const teamChannel = env.SLACK_CHANNEL_TEAM;
  if (teamChannel && channelId === teamChannel) {
    // Empty text shouldn't reach this branch (subtype guard catches edits)
    // but be defensive anyway.
    if (text.trim().length === 0) {
      console.log("[slack/events] team-channel message ignored — empty text");
      return NextResponse.json({ ok: true, ignored: "empty_text" });
    }

    // Named ops commands first. These work regardless of who typed them
    // (Georges or anyone else with channel access).
    const command = detectTeamCommand(text);
    if (command) {
      console.log("[slack/events] team command detected:", command.kind);
      switch (command.kind) {
        case "standup":
          await inngest.send({
            name: "tamtam/team.standup",
            data: { trigger: "manual" },
          });
          break;
        case "wrapup":
          await inngest.send({
            name: "tamtam/team.friday-wrapup",
            data: { trigger: "manual" },
          });
          break;
        case "moment":
          await inngest.send({
            name: "tamtam/team.random-moment",
            data: { trigger: "manual", slot: "manual" },
          });
          break;
        case "test_reactions":
          await inngest.send({
            name: "tamtam/team.test-reactions",
            data: { trigger: "manual" },
          });
          break;
      }
      return NextResponse.json({ ok: true, dispatched: `team.${command.kind}` });
    }

    // No command, no @-mention. Treat as Georges checking in. (We only
    // route check-ins from the configured Georges user id; otherwise
    // we'd respond to every team member who joins the channel.)
    const georgesId = env.SLACK_GEORGES_USER_ID;
    if (!georgesId) {
      console.log(
        "[slack/events] team-channel message ignored — SLACK_GEORGES_USER_ID not set",
      );
      return NextResponse.json({ ok: true, ignored: "checkin_disabled" });
    }
    if (event.user !== georgesId) {
      console.log(
        "[slack/events] team-channel message ignored — not from Georges (user=",
        event.user,
        ")",
      );
      return NextResponse.json({ ok: true, ignored: "not_georges" });
    }
    // Skip messages that contain a bot @-mention — the app_mention
    // event arrives separately and the per-agent path handles it.
    if (text.includes("<@")) {
      console.log(
        "[slack/events] team-channel message ignored — contains @-mention",
      );
      return NextResponse.json({ ok: true, ignored: "has_mention" });
    }

    await inngest.send({
      name: "tamtam/georges.checkin",
      data: {
        text,
        channel: channelId,
        user: event.user ?? "",
        event_ts: event.event_ts ?? event.ts ?? "",
        thread_ts: event.thread_ts,
      },
    });
    console.log("[slack/events] inngest event emitted: tamtam/georges.checkin");
    return NextResponse.json({ ok: true, dispatched: "georges_checkin" });
  }

  /* ────────────────────────────────────────────────────────────────────── */
  /*  Branch B: agent channels — app_mention routes by channel              */
  /* ────────────────────────────────────────────────────────────────────── */

  if (event.type !== "app_mention") {
    console.log("[slack/events] ignored event type:", event.type);
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  const agent = detectAgentFromChannel(channelId);
  console.log(
    "[slack/events] routing by channel:",
    channelId,
    "→ agent:",
    agent,
  );

  if (!agent) {
    console.log(
      "[slack/events] no agent matched channel — channel was:",
      channelId,
      "expected one of:",
      env.SLACK_CHANNEL_SOCIAL,
      env.SLACK_CHANNEL_GROWTH,
      env.SLACK_CHANNEL_COO,
    );
    return NextResponse.json({ ok: true, ignored: "unrecognized_channel" });
  }

  await Promise.all([
    inngest.send({
      name: MENTION_EVENT_NAME[agent],
      data: {
        text,
        channel: channelId,
        user: event.user ?? "",
        thread_ts: event.thread_ts,
        event_ts: event.event_ts ?? event.ts ?? "",
      },
    }),
    logAgentAction({
      agent,
      action: "slack.mention.received",
      metadata: {
        channel: channelId,
        user: event.user ?? null,
        ts: event.event_ts ?? event.ts ?? null,
      },
      status: "started",
    }).catch(() => undefined),
  ]);

  console.log(
    "[slack/events] inngest event emitted:",
    MENTION_EVENT_NAME[agent],
  );
  return NextResponse.json({ ok: true, dispatched: agent });
}
