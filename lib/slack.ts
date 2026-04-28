/**
 * Slack client + three agent personas.
 *
 * One Slack app, ONE bot token, three display identities. We use
 * `chat.postMessage` with `username` + `icon_emoji` so a single bot
 * can speak as Social, Growth, or COO via `chat.write.customize`.
 *
 * Slack request signing is verified here so route handlers can stay tiny.
 */

import { App } from "@slack/bolt";
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
/*  Personas                                                                  */
/* -------------------------------------------------------------------------- */

export const PERSONAS: Record<AgentName, AgentPersona> = {
  social: {
    name: "social",
    username: "🎨 Tamtam Social",
    iconEmoji: ":art:",
  },
  growth: {
    name: "growth",
    username: "📈 Tamtam Growth",
    iconEmoji: ":chart_with_upwards_trend:",
  },
  coo: {
    name: "coo",
    username: "🧠 Tamtam COO",
    iconEmoji: ":brain:",
  },
};

/* -------------------------------------------------------------------------- */
/*  Clients                                                                   */
/* -------------------------------------------------------------------------- */

let webSingleton: WebClient | null = null;
let boltSingleton: App | null = null;

export function getSlackWeb(): WebClient {
  if (webSingleton) return webSingleton;
  webSingleton = new WebClient(env.SLACK_BOT_TOKEN);
  return webSingleton;
}

/**
 * The Bolt App is exposed for typed event listeners (used in tests and
 * potentially a future custom receiver). Route handlers do not run Bolt
 * directly — they verify signatures and dispatch via plain functions.
 */
export function getSlackBolt(): App {
  if (boltSingleton) return boltSingleton;
  boltSingleton = new App({
    token: env.SLACK_BOT_TOKEN,
    signingSecret: env.SLACK_SIGNING_SECRET,
    // We do not start a receiver — Bolt is used purely as a typed wrapper.
  });
  return boltSingleton;
}

/* -------------------------------------------------------------------------- */
/*  Posting as a persona                                                      */
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

export async function postAsAgent(
  input: PostAsAgentInput,
): Promise<PostAsAgentResult> {
  const persona = PERSONAS[input.agent];
  const res = await getSlackWeb().chat.postMessage({
    channel: input.channel,
    text: input.text,
    // chat.write.customize lets one bot speak under multiple identities:
    username: persona.username,
    icon_emoji: persona.iconEmoji,
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

export async function updateAgentMessage(input: {
  /** Kept on the signature for symmetry with postAsAgent; unused by chat.update. */
  agent: AgentName;
  channel: string;
  ts: string;
  text: string;
  blocks?: ReadonlyArray<unknown>;
}): Promise<void> {
  // chat.update does not accept username/icon_emoji — the original message
  // already carries the persona identity, and edits inherit it.
  void input.agent;
  const res = await getSlackWeb().chat.update({
    channel: input.channel,
    ts: input.ts,
    text: input.text,
    blocks: input.blocks as never,
  });
  if (!res.ok) {
    throw new Error(`[slack] updateAgentMessage failed: ${res.error ?? "unknown"}`);
  }
}

/* -------------------------------------------------------------------------- */
/*  Approval block builder                                                    */
/* -------------------------------------------------------------------------- */

const APPROVAL_ACTION_ID = "tamtam_approval_action";

export function buildApprovalBlocks(args: {
  approvalId: string;
  headline: string;
  preview: string;
  imageUrl?: string | null;
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

  if (args.imageUrl) {
    blocks.push({
      type: "image",
      image_url: args.imageUrl,
      alt_text: "Generated post preview",
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
/*  Direct messages                                                           */
/* -------------------------------------------------------------------------- */

const dmChannelCache = new Map<string, string>();

/**
 * Resolve (and cache) the DM channel id for a Slack user via
 * `conversations.open`. Returns the channel id you can pass to
 * `chat.postMessage` to land a real DM.
 */
export async function openDmChannelFor(userId: string): Promise<string> {
  const cached = dmChannelCache.get(userId);
  if (cached) return cached;

  const res = await getSlackWeb().conversations.open({ users: userId });
  if (!res.ok || !res.channel?.id) {
    throw new Error(
      `[slack] conversations.open(${userId}) failed: ${res.error ?? "unknown"}`,
    );
  }
  dmChannelCache.set(userId, res.channel.id);
  return res.channel.id;
}

/* -------------------------------------------------------------------------- */
/*  Per-agent default channel                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The Slack channel each agent uses by default for approvals and replies.
 * The COO posts the daily brief and any escalation here too.
 */
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

/* -------------------------------------------------------------------------- */
/*  Mention parsing                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Map a Slack `app_mention` payload to one of our three agents based on
 * trigger keywords in the message body. We only have one bot user, so we
 * cannot route by user_id alone — we route by name keyword instead.
 *
 * Returns null if the mention doesn't reference a specific agent so the
 * caller can ignore (or default) it.
 */
export function detectAgentFromMention(text: string): AgentName | null {
  const lower = text.toLowerCase();
  // Order matters: a single message could in theory reference more than
  // one agent; we route by first match in priority order.
  if (/\btamtam[\s-]?social\b/.test(lower) || /\bsocial\b/.test(lower)) {
    return "social";
  }
  if (/\btamtam[\s-]?growth\b/.test(lower) || /\bgrowth\b/.test(lower)) {
    return "growth";
  }
  if (/\btamtam[\s-]?coo\b/.test(lower) || /\bcoo\b/.test(lower)) {
    return "coo";
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Signature verification                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Verify Slack's x-slack-signature header per
 * https://api.slack.com/authentication/verifying-requests-from-slack.
 *
 * Returns true if the signature matches and the timestamp is within 5
 * minutes (replay-attack window).
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
