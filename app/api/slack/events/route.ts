/**
 * Slack Events API endpoint — receives traffic from THREE Slack apps.
 *
 * Pipeline (in order):
 *   1. validateEnv()                 — fail fast if Vercel is misconfigured
 *   2. parse JSON enough to read api_app_id     (URL verification short-circuits here)
 *   3. verify signature with the matching app's signing secret
 *   4. STRICT bot guard              — drop anything with bot_id (loop guard)
 *   5. team-channel branch           — special commands + Georges check-in + member_joined
 *   6. agent-channel branch          — app_mention → routed by channel id
 *
 * Each Slack app (Awa / Kofi / Rama) points at this same URL. We
 * disambiguate by reading `api_app_id` from the body and looking up
 * the right signing secret via `getSigningSecretForApp(appId)`.
 */

import { NextResponse } from "next/server";
import { env, validateEnv, MissingEnvError } from "@/lib/env";
import {
  detectAgentFromChannel,
  getSigningSecretForApp,
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

interface SlackInboundEvent {
  type: string;
  user?: string;
  text?: string;
  ts?: string;
  channel?: string;
  event_ts?: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
  /** Set on member_joined_channel events. */
  inviter?: string;
}

interface SlackEventCallback {
  type: "event_callback";
  event_id: string;
  event_time: number;
  api_app_id: string;
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

  // Parse once, up front — we need api_app_id to choose the right
  // signing secret. If the body is malformed, reject before we even
  // try to verify a signature (a malformed body cannot be signed
  // correctly anyway).
  let payload: SlackPayload;
  try {
    payload = JSON.parse(rawBody) as SlackPayload;
  } catch {
    console.log("[slack/events] body is not valid JSON");
    return new NextResponse("invalid json", { status: 400 });
  }

  // Slack URL verification handshake — Slack sends this from each
  // app when the URL is added to Event Subscriptions. No signature
  // is sent for this, so handle it before signature checks.
  if (payload.type === "url_verification") {
    console.log("[slack/events] url_verification handshake");
    return NextResponse.json({ challenge: payload.challenge });
  }

  if (payload.type !== "event_callback") {
    console.log("[slack/events] ignored non_event_callback");
    return NextResponse.json({ ok: true, ignored: "non_event_callback" });
  }

  const appId = payload.api_app_id;
  console.log("[slack/events] api_app_id:", appId);
  const signingSecret = getSigningSecretForApp(appId);

  const ok = verifySlackSignature({
    signingSecret,
    rawBody,
    timestamp: req.headers.get("x-slack-request-timestamp"),
    signature: req.headers.get("x-slack-signature"),
  });
  if (!ok) {
    console.log(
      "[slack/events] signature verification FAILED for app:",
      appId,
    );
    return new NextResponse("invalid signature", { status: 401 });
  }

  const event = payload.event;
  console.log("[slack/events] event:", JSON.stringify(event));

  // STRICT bot guard. Any bot-originated event drops here — including
  // bot-originated app_mentions. With three Slack apps now posting in
  // shared channels, this is the loop guard: when Awa posts, the
  // event Slack delivers carries Awa's bot_id, and we must never
  // re-trigger.
  if (event.bot_id) {
    console.log(
      "[slack/events] ignored bot message — bot_id=",
      event.bot_id,
      "type=",
      event.type,
    );
    return NextResponse.json({ ok: true, ignored: "bot_message" });
  }

  if (event.subtype) {
    console.log("[slack/events] ignored — subtype:", event.subtype);
    return NextResponse.json({ ok: true, ignored: `subtype_${event.subtype}` });
  }

  const channelId = event.channel ?? "";
  const text = event.text ?? "";

  /* ────────────────────────────────────────────────────────────────────── */
  /*  Branch A: #tamtam-team — commands, check-ins, onboarding              */
  /* ────────────────────────────────────────────────────────────────────── */

  const teamChannel = env.SLACK_CHANNEL_TEAM;
  if (teamChannel && channelId === teamChannel) {
    // Member joined the team channel — fire the onboarding flow.
    if (event.type === "member_joined_channel") {
      if (!event.user) {
        return NextResponse.json({ ok: true, ignored: "no_user" });
      }
      await inngest.send({
        name: "tamtam/team.member-joined",
        data: {
          user_id: event.user,
          channel: channelId,
          event_ts: event.event_ts ?? event.ts ?? "",
        },
      });
      console.log(
        "[slack/events] inngest event emitted: tamtam/team.member-joined",
        event.user,
      );
      return NextResponse.json({ ok: true, dispatched: "member_joined" });
    }

    // Plain message in the team channel.
    if (text.trim().length === 0) {
      console.log("[slack/events] team-channel message ignored — empty text");
      return NextResponse.json({ ok: true, ignored: "empty_text" });
    }

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
        api_app_id: appId,
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
