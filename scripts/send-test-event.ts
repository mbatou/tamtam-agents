/**
 * Send a properly-signed Slack `app_mention` event to /api/slack/events.
 *
 * Lets you drive end-to-end agent runs without typing in Slack — useful
 * for debugging, demos, and CI smoke checks.
 *
 * Usage:
 *   npm run test:event -- <agent> "<message>"
 *   npm run test:event -- social "create a post about Tamtam"
 *   npm run test:event -- growth "research Sunugal"
 *   npm run test:event -- coo "what is the team status"
 *
 * Environment (read from process.env — pull with `vercel env pull` if
 * running locally against a Vercel-only project):
 *   SLACK_SIGNING_SECRET   — required, used to compute v0 HMAC
 *   APP_URL                — defaults to http://localhost:3000
 *   SLACK_CHANNEL_SOCIAL   — channel id used for the social mention
 *   SLACK_CHANNEL_GROWTH   — channel id used for the growth mention
 *   SLACK_CHANNEL_COO      — channel id used for the coo mention
 *   TEST_USER_ID           — optional, defaults to U_TEST
 *   TEST_BOT_USER_ID       — optional, defaults to U_BOT
 */

import { createHmac } from "node:crypto";

type Agent = "social" | "growth" | "coo";

function die(msg: string, code = 1): never {
  process.stderr.write(`✖ ${msg}\n`);
  process.exit(code);
}

function getRequiredEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) die(`${name} is not set`);
  return v;
}

function channelFor(agent: Agent): string {
  switch (agent) {
    case "social":
      return getRequiredEnv("SLACK_CHANNEL_SOCIAL");
    case "growth":
      return getRequiredEnv("SLACK_CHANNEL_GROWTH");
    case "coo":
      return getRequiredEnv("SLACK_CHANNEL_COO");
  }
}

async function main(): Promise<void> {
  const [agentArg, ...rest] = process.argv.slice(2);
  if (!agentArg || rest.length === 0) {
    die(
      'Usage: npm run test:event -- <social|growth|coo> "<message>"',
    );
  }
  if (agentArg !== "social" && agentArg !== "growth" && agentArg !== "coo") {
    die(`Unknown agent '${agentArg}'. Expected social | growth | coo.`);
  }
  const agent = agentArg as Agent;
  const message = rest.join(" ");

  const signingSecret = getRequiredEnv("SLACK_SIGNING_SECRET");
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const channel = channelFor(agent);
  const userId = process.env.TEST_USER_ID ?? "U_TEST";
  const botUserId = process.env.TEST_BOT_USER_ID ?? "U_BOT";

  const ts = Math.floor(Date.now() / 1000).toString();
  const event = {
    type: "app_mention",
    user: userId,
    text: `<@${botUserId}> tamtam-${agent} ${message}`,
    ts: `${ts}.000000`,
    channel,
    event_ts: `${ts}.000000`,
  };
  const body = JSON.stringify({
    type: "event_callback",
    event_id: "Ev" + Math.random().toString(36).slice(2, 14).toUpperCase(),
    event_time: Number.parseInt(ts, 10),
    event,
  });

  const baseString = `v0:${ts}:${body}`;
  const signature =
    "v0=" + createHmac("sha256", signingSecret).update(baseString).digest("hex");

  const url = `${appUrl.replace(/\/+$/, "")}/api/slack/events`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Slack-Request-Timestamp": ts,
      "X-Slack-Signature": signature,
    },
    body,
  });

  const responseText = await res.text();
  process.stdout.write(
    `→ ${url}\n` +
      `  agent: ${agent}\n` +
      `  channel: ${channel}\n` +
      `  message: ${message}\n` +
      `← ${res.status} ${res.statusText}\n` +
      `  ${responseText}\n`,
  );

  if (!res.ok) process.exit(2);
}

main().catch((err: unknown) => {
  die(err instanceof Error ? err.message : String(err), 3);
});
