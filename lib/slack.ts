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
