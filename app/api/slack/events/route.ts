/**
 * Slack Events API endpoint — receives traffic from THREE Slack apps.
 *
 * Critical-path order (everything before the 200 must be sub-second):
 *   1. validateEnv()                    sync, fast
 *   2. parse JSON                       sync, fast
 *   3. url_verification short-circuit   sync, fast
 *   4. signature verification           sync HMAC, fast
 *   5. RETURN 200 IMMEDIATELY           ← Slack gets the ACK here
 *   6. fire-and-forget dispatch         ← all routing + Inngest sends
 *
 * Slack retries when our 200 arrives after ~3 seconds. The previous
 * version did Supabase JSONB lookups + agent_logs inserts BEFORE the
 * ACK; Vercel cold starts pushed total response time over the
 * threshold, Slack retried, and we ended up with three runs of
 * `georges-checkin` for one human message.
 *
 * The new design:
 *   - All async work moves into `dispatchSlackEvent` which we don't
 *     await. The function-level Promise stays alive long enough for
 *     the Inngest POST to flush in normal Vercel runtime behaviour.
 *   - All Inngest sends carry an `id` derived from the Slack
 *     `event_id`. Inngest's native event-id dedup is now the ONLY
 *     dedup layer — and it's reliable because the id is ours and
 *     the same id from a Slack retry collapses to one job run.
 *
 * Note on fire-and-forget: if Inngest sends ever start dropping
 * under cold-start pressure, swap to `waitUntil` from
 * `@vercel/functions`. The promise structure here is already shaped
 * for that — wrap the dispatch call.
 */

import { NextResponse } from "next/server";
import { env, validateEnv, MissingEnvError } from "@/lib/env";
import {
  detectAgentFromChannel,
  getSigningSecretForApp,
  verifySlackSignature,
} from "@/lib/slack";
import { inngest } from "@/lib/inngest";
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
/*  Handler — sync to 200, async dispatch after                               */
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

  let payload: SlackPayload;
  try {
    payload = JSON.parse(rawBody) as SlackPayload;
  } catch {
    return new NextResponse("invalid json", { status: 400 });
  }

  // url_verification has no signature — short-circuit before we
  // try to verify one.
  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge });
  }

  if (payload.type !== "event_callback") {
    return NextResponse.json({ ok: true, ignored: "non_event_callback" });
  }

  const signingSecret = getSigningSecretForApp(payload.api_app_id);
  const ok = verifySlackSignature({
    signingSecret,
    rawBody,
    timestamp: req.headers.get("x-slack-request-timestamp"),
    signature: req.headers.get("x-slack-signature"),
  });
  if (!ok) {
    console.log(
      "[slack/events] signature verification FAILED for app:",
      payload.api_app_id,
    );
    return new NextResponse("invalid signature", { status: 401 });
  }

  // ACK to Slack IMMEDIATELY — everything below runs after the
  // response is on the wire. Slack's 3-second retry budget cannot
  // be tripped by anything we do post-return.
  const response = NextResponse.json({ ok: true });

  // Fire-and-forget. If Inngest sends ever start dropping under
  // Vercel cold starts, wrap this in `waitUntil` from
  // `@vercel/functions` — same dispatch, longer keep-alive.
  dispatchSlackEvent(payload).catch((err: unknown) => {
    console.error("[slack/events] dispatch error:", err);
  });

  return response;
}

/* -------------------------------------------------------------------------- */
/*  Dispatch — runs AFTER the 200                                             */
/* -------------------------------------------------------------------------- */

async function dispatchSlackEvent(payload: SlackEventCallback): Promise<void> {
  const event = payload.event;
  const eventId = payload.event_id;

  console.log(
    "[slack/events] dispatch:",
    "event_id=",
    eventId,
    "type=",
    event.type,
    "channel=",
    event.channel,
  );

  // Strict bot guard. With three Slack apps posting in shared
  // channels, a missed bot_id is a loop hazard.
  if (event.bot_id) {
    console.log(
      "[slack/events] ignored bot message — bot_id=",
      event.bot_id,
    );
    return;
  }

  if (event.subtype) {
    console.log("[slack/events] ignored — subtype:", event.subtype);
    return;
  }

  const channelId = event.channel ?? "";
  const text = event.text ?? "";

  /* ────────────────────────────────────────────────────────────────────── */
  /*  Branch A: #tamtam-team                                                */
  /* ────────────────────────────────────────────────────────────────────── */

  const teamChannel = env.SLACK_CHANNEL_TEAM;
  if (teamChannel && channelId === teamChannel) {
    if (event.type === "member_joined_channel") {
      if (!event.user) {
        console.log("[slack/events] member_joined without user — ignored");
        return;
      }
      await inngest.send({
        // Dedup: Slack retries of the same join collapse to one onboarding.
        id: `member-joined-${eventId}`,
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
      return;
    }

    if (text.trim().length === 0) {
      console.log("[slack/events] team-channel message ignored — empty text");
      return;
    }

    const command = detectTeamCommand(text);
    if (command) {
      console.log("[slack/events] team command detected:", command.kind);
      switch (command.kind) {
        case "standup":
          await inngest.send({
            id: `team-standup-${eventId}`,
            name: "tamtam/team.standup",
            data: { trigger: "manual" },
          });
          break;
        case "wrapup":
          await inngest.send({
            id: `team-wrapup-${eventId}`,
            name: "tamtam/team.friday-wrapup",
            data: { trigger: "manual" },
          });
          break;
        case "moment":
          await inngest.send({
            id: `team-moment-${eventId}`,
            name: "tamtam/team.random-moment",
            data: { trigger: "manual", slot: "manual" },
          });
          break;
        case "test_reactions":
          await inngest.send({
            id: `team-test-reactions-${eventId}`,
            name: "tamtam/team.test-reactions",
            data: { trigger: "manual" },
          });
          break;
      }
      return;
    }

    const georgesId = env.SLACK_GEORGES_USER_ID;
    if (!georgesId) {
      console.log(
        "[slack/events] team-channel message ignored — SLACK_GEORGES_USER_ID not set",
      );
      return;
    }
    if (event.user !== georgesId) {
      console.log(
        "[slack/events] team-channel message ignored — not from Georges (user=",
        event.user,
        ")",
      );
      return;
    }
    if (text.includes("<@")) {
      console.log(
        "[slack/events] team-channel message ignored — contains @-mention",
      );
      return;
    }

    // The CRITICAL dedup: Slack retries this exact event_id when our
    // 200 was slow. Inngest collapses identical event ids to a single
    // function run.
    await inngest.send({
      id: `georges-checkin-${eventId}`,
      name: "tamtam/georges.checkin",
      data: {
        text,
        channel: channelId,
        user: event.user ?? "",
        event_ts: event.event_ts ?? event.ts ?? "",
        thread_ts: event.thread_ts,
        slack_event_id: eventId,
      },
    });
    console.log(
      "[slack/events] inngest event emitted: tamtam/georges.checkin",
      "id=",
      `georges-checkin-${eventId}`,
    );
    return;
  }

  /* ────────────────────────────────────────────────────────────────────── */
  /*  Branch B: agent channels — app_mention routes by channel              */
  /* ────────────────────────────────────────────────────────────────────── */

  if (event.type !== "app_mention") {
    console.log("[slack/events] ignored event type:", event.type);
    return;
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
    return;
  }

  // app_mentions get the same id-dedup treatment — Slack retries
  // these too.
  await inngest.send({
    id: `mention-${eventId}`,
    name: MENTION_EVENT_NAME[agent],
    data: {
      text,
      channel: channelId,
      user: event.user ?? "",
      thread_ts: event.thread_ts,
      event_ts: event.event_ts ?? event.ts ?? "",
    },
  });

  console.log(
    "[slack/events] inngest event emitted:",
    MENTION_EVENT_NAME[agent],
    "id=",
    `mention-${eventId}`,
  );
}
