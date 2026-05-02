/**
 * Set each agent's Slack profile photo to their initials avatar.
 *
 * Run once after the three Slack apps are installed:
 *
 *   npm run set-avatars
 *
 * Each app must have the `users.profile:write` scope. The bot user
 * tokens (xoxb-…) are pulled from environment — `vercel env pull`
 * locally first if you don't have them on disk.
 *
 * `users.setPhoto` accepts a multipart form with the image bytes.
 * We use a Web `Blob` + `FormData` to build the body — both are
 * supported in Node 18+ and avoid the form-data dep.
 */

import { WebClient } from "@slack/web-api";
import type { AgentName } from "@/types";

interface AgentAvatarSpec {
  name: AgentName;
  firstName: string;
  url: string;
  tokenEnv: string;
}

const AVATARS: ReadonlyArray<AgentAvatarSpec> = [
  {
    name: "social",
    firstName: "Awa",
    url: "https://ui-avatars.com/api/?name=Awa+Diallo&background=D35400&color=fff&size=512&bold=true",
    tokenEnv: "SLACK_BOT_TOKEN_AWA",
  },
  {
    name: "growth",
    firstName: "Kofi",
    url: "https://ui-avatars.com/api/?name=Kofi+Mensah&background=2D6A4F&color=fff&size=512&bold=true",
    tokenEnv: "SLACK_BOT_TOKEN_KOFI",
  },
  {
    name: "coo",
    firstName: "Rama",
    url: "https://ui-avatars.com/api/?name=Rama+Sall&background=4A4E69&color=fff&size=512&bold=true",
    tokenEnv: "SLACK_BOT_TOKEN_RAMA",
  },
];

function die(msg: string, code = 1): never {
  process.stderr.write(`✖ ${msg}\n`);
  process.exit(code);
}

async function fetchAvatarBytes(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    die(`failed to fetch ${url}: HTTP ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  return Buffer.from(buf);
}

async function setOne(spec: AgentAvatarSpec): Promise<void> {
  const token = process.env[spec.tokenEnv];
  if (!token) die(`missing ${spec.tokenEnv}`);

  process.stdout.write(`→ ${spec.firstName}: downloading avatar…\n`);
  const bytes = await fetchAvatarBytes(spec.url);

  const client = new WebClient(token);
  const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
  const form = new FormData();
  form.set("image", blob, `${spec.firstName.toLowerCase()}.png`);

  // The Slack SDK doesn't expose a typed users.setPhoto helper for
  // multipart bodies, so we drop down to apiCall with the FormData.
  const res = (await client.apiCall("users.setPhoto", form as never)) as {
    ok: boolean;
    error?: string;
  };
  if (!res.ok) die(`${spec.firstName}: users.setPhoto failed: ${res.error ?? "unknown"}`);

  process.stdout.write(`✓ ${spec.firstName}: photo set\n`);
}

async function main(): Promise<void> {
  for (const spec of AVATARS) {
    try {
      await setOne(spec);
    } catch (err) {
      die(err instanceof Error ? err.message : String(err), 2);
    }
  }
  process.stdout.write("\nDone. Each agent now has their initials avatar.\n");
}

main().catch((err) => {
  die(err instanceof Error ? err.message : String(err), 3);
});
