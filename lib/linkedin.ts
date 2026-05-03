/**
 * LinkedIn integration — connection requests, messaging, inbox poll.
 *
 * IMPORTANT — capability reality check:
 *
 *   The "Share on LinkedIn" API (Marketing Developer Platform) is
 *   approved for posting to a Page. That capability does NOT cover:
 *     - sending connection requests on a user's behalf
 *     - sending direct messages to other LinkedIn members
 *     - reading the bot user's inbox
 *
 *   Those endpoints live behind Sales Navigator API / Talent
 *   Solutions / Partner-tier programs and require a separate ~6-month
 *   approval process. Until that approval lands, this module operates
 *   in FALLBACK MODE:
 *
 *     - sendConnectionRequest  → logs the intended note + posts a
 *                                "queued for manual send" line in
 *                                #tamtam-growth, returns a synthetic
 *                                request id `manual-${ts}`.
 *     - sendLinkedInMessage    → same fallback shape.
 *     - getLinkedInMessages    → returns [] (no API to poll yet).
 *
 *   When LINKEDIN_ACCESS_TOKEN is set AND a future LinkedIn upgrade
 *   provides usable endpoints, swap each function's body to the
 *   real call. The signatures stay stable so callers don't change.
 */

import { env } from "./env";
import { logAgentAction } from "./supabase";
import { defaultChannelFor, postAsAgent } from "./slack";

/* -------------------------------------------------------------------------- */
/*  Connection requests                                                       */
/* -------------------------------------------------------------------------- */

export interface SendConnectionRequestInput {
  /** Public profile URL like https://linkedin.com/in/<slug>. */
  profileUrl: string;
  /** ≤ 300 chars. Slack rule: ≤ 20 words for connection notes. */
  note: string;
  /** Optional company tag for the audit trail. */
  company?: string;
}

export interface SendConnectionRequestResult {
  ok: true;
  request_id: string;
  /** "real" once LinkedIn approval lands; "fallback" until then. */
  mode: "real" | "fallback";
}

export async function sendConnectionRequest(
  input: SendConnectionRequestInput,
): Promise<SendConnectionRequestResult> {
  const token = env.LINKEDIN_ACCESS_TOKEN;
  if (!token) {
    return runConnectionFallback(input);
  }

  // TODO(linkedin-real): when messaging API access lands, POST to
  //   /v2/invitations with body { invitee: { 'com.linkedin.voyager.…' },
  //                                message: { ... } }
  //   For now we fall back even when the token is set, because the
  //   token alone doesn't grant the scope.
  return runConnectionFallback(input);
}

async function runConnectionFallback(
  input: SendConnectionRequestInput,
): Promise<SendConnectionRequestResult> {
  const requestId = `manual-conn-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  await logAgentAction({
    agent: "growth",
    action: "linkedin.connection.queued",
    metadata: {
      profile_url: input.profileUrl,
      note: input.note,
      company: input.company ?? null,
      request_id: requestId,
      reason: "linkedin_messaging_not_yet_approved",
    },
    status: "skipped",
  });

  await postAsAgent({
    agent: "growth",
    channel: defaultChannelFor("growth"),
    text:
      `:link: Queued for manual send — connection request to ` +
      `${input.company ?? input.profileUrl}\n` +
      `> ${input.note}\n` +
      `_(LinkedIn messaging API not yet approved; once it is, this ` +
      `path becomes a real call.)_`,
  }).catch(() => undefined);

  return { ok: true, request_id: requestId, mode: "fallback" };
}

/* -------------------------------------------------------------------------- */
/*  Direct messages                                                           */
/* -------------------------------------------------------------------------- */

export interface SendLinkedInMessageInput {
  /** Connection id from a previous successful sendConnectionRequest. */
  connectionId: string;
  message: string;
  company?: string;
}

export interface SendLinkedInMessageResult {
  ok: true;
  message_id: string;
  mode: "real" | "fallback";
}

export async function sendLinkedInMessage(
  input: SendLinkedInMessageInput,
): Promise<SendLinkedInMessageResult> {
  const messageId = `manual-msg-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  await logAgentAction({
    agent: "growth",
    action: "linkedin.message.queued",
    metadata: {
      connection_id: input.connectionId,
      message_preview: input.message.slice(0, 240),
      company: input.company ?? null,
      message_id: messageId,
      reason: "linkedin_messaging_not_yet_approved",
    },
    status: "skipped",
  });

  await postAsAgent({
    agent: "growth",
    channel: defaultChannelFor("growth"),
    text:
      `:speech_balloon: Queued for manual send — LinkedIn DM to ` +
      `${input.company ?? "connection " + input.connectionId}\n` +
      "```\n" +
      (input.message.length > 600
        ? input.message.slice(0, 600) + "…"
        : input.message) +
      "\n```",
  }).catch(() => undefined);

  return { ok: true, message_id: messageId, mode: "fallback" };
}

/* -------------------------------------------------------------------------- */
/*  Inbox poll                                                                */
/* -------------------------------------------------------------------------- */

export interface LinkedInInboundMessage {
  sender_id: string;
  message: string;
  /** ISO timestamp. */
  received_at: string;
  /** Original linkedin connection id when known. */
  connection_id?: string;
}

/**
 * Returns recent inbound LinkedIn messages. With no messaging API
 * scope, this is a [] no-op — Kofi's response monitor will find
 * nothing on the LinkedIn side until partnership-tier access exists.
 *
 * Email replies still flow through /api/webhooks/email-reply, so the
 * response-classification pipeline isn't blocked by this gap.
 */
export async function getLinkedInMessages(): Promise<LinkedInInboundMessage[]> {
  const token = env.LINKEDIN_ACCESS_TOKEN;
  if (!token) return [];

  // TODO(linkedin-real): GET /v2/messaging/conversations + messages
  //   when partnership API access exists.
  return [];
}
