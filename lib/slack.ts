/**
 * Slack clients — three dedicated apps, one per agent identity.
 *
 * Awa, Kofi, and Rama each have their own Slack app with their own
 * bot token, signing secret, app id, and Slack user identity. There
 * are no `chat.write.customize` persona overrides anywhere — when
 * Awa speaks, it's literally Awa's app posting through Awa's token.
 *
 * Required Slack scopes per app (set in each Slack app dashboard):
 *   - chat:write
 *   - chat:write.public
 *   - app_mentions:read
 *   - channels:history
 *   - im:write, im:history
 *   - users.profile:write   (status rotation + avatar setup)
 *   - users:read
 *
 * Required event subscriptions per app (Event Subscriptions tab):
 *   - app_mention
 *   - message.channels
 *   - member_joined_channel
 */

import { WebClient } from "@slack/web-api";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import type {
  AgentName,
  AgentPersona,
  ApprovalAction,
  ApprovalButtonValue,
} from "@/types";

/* -------------------------------------------------------------------------- */
/*  Personas — identity metadata only (display + first name)                  */
/* -------------------------------------------------------------------------- */

export const PERSONAS: Record<AgentName, AgentPersona> = {
  social: {
    name: "social",
    firstName: "Awa",
    username: "Awa Diallo",
    iconEmoji: ":art:",
  },
  growth: {
    name: "growth",
    firstName: "Kofi",
    username: "Kofi Mensah",
    iconEmoji: ":chart_with_upwards_trend:",
  },
  coo: {
    name: "coo",
    firstName: "Rama",
    username: "Rama Sall",
    iconEmoji: ":brain:",
  },
};

/* -------------------------------------------------------------------------- */
/*  Three dedicated Web API clients                                           */
/* -------------------------------------------------------------------------- */

let awaSingleton: WebClient | null = null;
let kofiSingleton: WebClient | null = null;
let ramaSingleton: WebClient | null = null;

/** The Slack client whose bot user is the named agent. */
export function getClientFor(agent: AgentName): WebClient {
  switch (agent) {
    case "social":
      if (!awaSingleton) awaSingleton = new WebClient(env.SLACK_BOT_TOKEN_AWA);
      return awaSingleton;
    case "growth":
      if (!kofiSingleton) kofiSingleton = new WebClient(env.SLACK_BOT_TOKEN_KOFI);
      return kofiSingleton;
    case "coo":
      if (!ramaSingleton) ramaSingleton = new WebClient(env.SLACK_BOT_TOKEN_RAMA);
      return ramaSingleton;
  }
}

/* -------------------------------------------------------------------------- */
/*  Multi-app signing-secret lookup                                           */
/* -------------------------------------------------------------------------- */

/**
 * Map a Slack `api_app_id` to the signing secret of the app that sent
 * the request. Used by /api/slack/events and /api/slack/interactions
 * to verify request signatures correctly when one Vercel endpoint
 * receives traffic from three different Slack apps.
 *
 * Falls back to Rama's secret if the app id doesn't match — that
 * keeps the route from leaking which app ids are recognised, while
 * still failing the signature check (the secret won't match).
 */
export function getSigningSecretForApp(appId: string | null | undefined): string {
  if (!appId) return env.SLACK_SIGNING_SECRET_RAMA;
  if (appId === env.SLACK_APP_ID_AWA) return env.SLACK_SIGNING_SECRET_AWA;
  if (appId === env.SLACK_APP_ID_KOFI) return env.SLACK_SIGNING_SECRET_KOFI;
  if (appId === env.SLACK_APP_ID_RAMA) return env.SLACK_SIGNING_SECRET_RAMA;
  return env.SLACK_SIGNING_SECRET_RAMA;
}

/* -------------------------------------------------------------------------- */
/*  Posting                                                                   */
/* -------------------------------------------------------------------------- */

export interface PostAsAgentInput {
  agent: AgentName;
  channel: string;
  text: string;
  blocks?: ReadonlyArray<unknown>;
  threadTs?: string;
}

export interface PostAsAgentResult {
  ok: true;
  ts: string;
  channel: string;
}

/**
 * Post a message as the given agent, using that agent's dedicated
 * Slack client. NO persona overrides — the bot user IS the agent.
 *
 * Prefer `respondWithTyping` for user-facing replies — it adds the
 * 1.5–2.5s pause that makes the message feel typed.
 */
export async function postAsAgent(
  input: PostAsAgentInput,
): Promise<PostAsAgentResult> {
  const res = await getClientFor(input.agent).chat.postMessage({
    channel: input.channel,
    text: input.text,
    blocks: input.blocks as never,
    thread_ts: input.threadTs,
  });

  if (!res.ok || !res.ts || !res.channel) {
    throw new Error(
      `[slack] postAsAgent(${input.agent}) failed: ${res.error ?? "unknown"}`,
    );
  }
  return { ok: true, ts: res.ts, channel: res.channel };
}

/**
 * Slack's Web API does not expose a real "User is typing…" indicator
 * for bot users (that capability lives only in the deprecated RTM
 * API). We approximate the UX by pausing 1.5–2.5 seconds before
 * posting — the gap before the message creates the typing feel
 * without an API call that doesn't exist.
 *
 * If Slack ever ships a public Web API for this, swap the body of
 * `sendTypingIndicator` to call it.
 */
export async function sendTypingIndicator(
  _agent: AgentName,
  _channel: string,
): Promise<void> {
  // Intentionally a no-op — see doc comment.
  return;
}

const MIN_TYPING_DELAY_MS = 1500;
const MAX_TYPING_DELAY_MS = 2500;

function typingDelayMs(): number {
  return (
    MIN_TYPING_DELAY_MS +
    Math.floor(Math.random() * (MAX_TYPING_DELAY_MS - MIN_TYPING_DELAY_MS))
  );
}

/**
 * Post a message after a 1.5–2.5s "thinking" pause so it feels
 * like the agent typed it rather than fired it off instantly.
 *
 * Use this everywhere instead of `postAsAgent` for user-facing
 * replies. Direct `postAsAgent` is fine for system-internal posts
 * (status updates, mock-test fan-outs, etc.).
 */
export async function respondWithTyping(
  input: PostAsAgentInput,
): Promise<PostAsAgentResult> {
  await sendTypingIndicator(input.agent, input.channel);
  await new Promise((resolve) => setTimeout(resolve, typingDelayMs()));
  return postAsAgent(input);
}

export async function updateAgentMessage(input: {
  agent: AgentName;
  channel: string;
  ts: string;
  text: string;
  blocks?: ReadonlyArray<unknown>;
}): Promise<void> {
  const res = await getClientFor(input.agent).chat.update({
    channel: input.channel,
    ts: input.ts,
    text: input.text,
    blocks: input.blocks as never,
  });
  if (!res.ok) {
    throw new Error(
      `[slack] updateAgentMessage failed: ${res.error ?? "unknown"}`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/*  DMs                                                                       */
/* -------------------------------------------------------------------------- */

const dmChannelCache = new Map<string, string>();

/**
 * Resolve (and cache) the DM channel id for a Slack user via
 * `conversations.open`, opened by the specified agent's app.
 * Returned channel id is what you pass to `chat.postMessage` to
 * land a real DM.
 */
export async function openDmChannelFor(
  agent: AgentName,
  userId: string,
): Promise<string> {
  const cacheKey = `${agent}:${userId}`;
  const cached = dmChannelCache.get(cacheKey);
  if (cached) return cached;

  const res = await getClientFor(agent).conversations.open({ users: userId });
  if (!res.ok || !res.channel?.id) {
    throw new Error(
      `[slack] conversations.open(${agent}, ${userId}) failed: ${res.error ?? "unknown"}`,
    );
  }
  dmChannelCache.set(cacheKey, res.channel.id);
  return res.channel.id;
}

/**
 * Post a DM to Georges from the named agent. No-ops (returns null)
 * when SLACK_GEORGES_USER_ID is not configured — the caller can
 * decide whether to fall back to a channel-mention.
 */
export async function dmGeorges(input: {
  agent: AgentName;
  text: string;
  blocks?: ReadonlyArray<unknown>;
}): Promise<PostAsAgentResult | null> {
  const userId = env.SLACK_GEORGES_USER_ID;
  if (!userId) return null;
  const channel = await openDmChannelFor(input.agent, userId);
  return postAsAgent({
    agent: input.agent,
    channel,
    text: input.text,
    blocks: input.blocks,
  });
}

/* -------------------------------------------------------------------------- */
/*  Status (users.profile.set)                                                */
/* -------------------------------------------------------------------------- */

export interface SetStatusInput {
  agent: AgentName;
  /** Status text (≤ 100 chars). Empty string clears. */
  statusText: string;
  /** Slack-style emoji code, e.g. `:art:`. Empty string clears. */
  statusEmoji: string;
  /** Unix timestamp (seconds) when the status auto-clears. 0 = never. */
  expiration?: number;
}

/**
 * Set the agent's Slack profile status. Requires the
 * `users.profile:write` scope on that agent's Slack app.
 */
export async function setAgentStatus(
  input: SetStatusInput,
): Promise<void> {
  // The Slack SDK's typed `profile` arg expects a Record-shaped
  // object; we cast through `unknown` to satisfy that shape. The
  // actual Slack API accepts these three fields directly.
  const profile = {
    status_text: input.statusText,
    status_emoji: input.statusEmoji,
    status_expiration: input.expiration ?? 0,
  } as unknown as Record<string, unknown>;

  const res = await getClientFor(input.agent).users.profile.set({ profile });
  if (!res.ok) {
    throw new Error(
      `[slack] setAgentStatus(${input.agent}) failed: ${res.error ?? "unknown"}`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/*  Per-agent default channel                                                 */
/* -------------------------------------------------------------------------- */

export function defaultChannelFor(agent: AgentName): string {
  switch (agent) {
    case "social":
      return env.SLACK_CHANNEL_SOCIAL;
    case "growth":
      return env.SLACK_CHANNEL_GROWTH;
    case "coo":
      return env.SLACK_CHANNEL_COO;
  }
}

export function teamChannelOrNull(): string | null {
  return env.SLACK_CHANNEL_TEAM ?? null;
}

/* -------------------------------------------------------------------------- */
/*  Channel routing                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Map a Slack channel id to the agent that owns that channel.
 * Returns null when the channel isn't one of the three agent
 * channels — used to decide whether a mention is routable.
 */
export function detectAgentFromChannel(channelId: string): AgentName | null {
  if (channelId === env.SLACK_CHANNEL_SOCIAL) return "social";
  if (channelId === env.SLACK_CHANNEL_GROWTH) return "growth";
  if (channelId === env.SLACK_CHANNEL_COO) return "coo";
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Approval block builder                                                    */
/* -------------------------------------------------------------------------- */

const APPROVAL_ACTION_ID = "tamtam_approval_action";

/**
 * Slack only reliably renders inline images hosted on
 * https://files.slack.com — external URLs (placehold.co, Supabase
 * Storage, etc.) get rejected by the unfurler. Until DALL-E images
 * are uploaded via files.uploadV2 first, we surface the prompt as a
 * context block instead.
 */
const SLACK_HOSTED_IMAGE_PREFIX = "https://files.slack.com";

export function isSlackHostedImage(url: string | null | undefined): boolean {
  return !!url && url.startsWith(SLACK_HOSTED_IMAGE_PREFIX);
}

export function buildApprovalBlocks(args: {
  approvalId: string;
  headline: string;
  preview: string;
  imageUrl?: string | null;
  imagePrompt?: string | null;
}): ReadonlyArray<unknown> {
  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: args.headline, emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: args.preview },
    },
  ];

  if (isSlackHostedImage(args.imageUrl)) {
    blocks.push({
      type: "image",
      image_url: args.imageUrl,
      alt_text: "Generated post preview",
    });
  } else if (args.imagePrompt && args.imagePrompt.trim().length > 0) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `🎨 *Image prompt:* ${args.imagePrompt}`,
        },
      ],
    });
  }

  blocks.push({
    type: "actions",
    block_id: `approval_${args.approvalId}`,
    elements: (["approve", "edit", "reject"] as ApprovalAction[]).map(
      (action) => ({
        type: "button",
        action_id: `${APPROVAL_ACTION_ID}_${action}`,
        text: {
          type: "plain_text",
          text:
            action === "approve"
              ? "Approve ✅"
              : action === "edit"
                ? "Edit ✏️"
                : "Reject ❌",
        },
        style:
          action === "approve"
            ? "primary"
            : action === "reject"
              ? "danger"
              : undefined,
        value: JSON.stringify({
          approval_id: args.approvalId,
          action,
        } satisfies ApprovalButtonValue),
      }),
    ),
  });

  return blocks;
}

export function isApprovalActionId(actionId: string): boolean {
  return actionId.startsWith(`${APPROVAL_ACTION_ID}_`);
}

/* -------------------------------------------------------------------------- */
/*  Signature verification                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Verify Slack's x-slack-signature header. Pass the signing secret
 * for the specific Slack app that originated the request — look it
 * up via `getSigningSecretForApp(appId)` after extracting `api_app_id`
 * from the JSON body.
 */
export function verifySlackSignature(args: {
  signingSecret: string;
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
}): boolean {
  if (!args.timestamp || !args.signature) return false;

  const ts = Number.parseInt(args.timestamp, 10);
  if (!Number.isFinite(ts)) return false;

  const fiveMinutes = 60 * 5;
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > fiveMinutes) {
    return false;
  }

  const base = `v0:${args.timestamp}:${args.rawBody}`;
  const computed =
    "v0=" +
    createHmac("sha256", args.signingSecret).update(base).digest("hex");

  const a = Buffer.from(computed);
  const b = Buffer.from(args.signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
