/**
 * Persona-flavored text generation for team-life moments.
 *
 * The four cron / event functions in inngest/functions/team-*.ts all
 * follow the same shape: "ask Claude to compose something in <persona>'s
 * voice given <context>, then post it as that persona to <channel>".
 *
 * Centralised here so the per-function files stay short and the prompt
 * scaffolding is consistent.
 */

import { generateText } from "@/lib/anthropic";
import { logAgentAction } from "@/lib/supabase";
import {
  PERSONAS,
  respondWithTyping,
  teamChannelOrNull,
} from "@/lib/slack";
import { SOCIAL_SYSTEM_PROMPT } from "@/agents/social/system-prompt";
import { GROWTH_SYSTEM_PROMPT } from "@/agents/growth/system-prompt";
import { COO_SYSTEM_PROMPT } from "@/agents/coo/system-prompt";
import type { AgentName } from "@/types";

const PERSONA_PROMPTS: Record<AgentName, string> = {
  social: SOCIAL_SYSTEM_PROMPT,
  growth: GROWTH_SYSTEM_PROMPT,
  coo: COO_SYSTEM_PROMPT,
};

export interface SpeakAsInput {
  agent: AgentName;
  /** What to compose. Concrete; describe context not format. */
  brief: string;
  /** Where to post. Defaults to the team channel. */
  channel?: string;
  /** Optional thread to reply in. */
  threadTs?: string;
  /** Tagged onto the agent_logs row so we can audit the source. */
  source: string;
  /** Hard token cap for the generation (defaults to 350 — short on purpose). */
  maxTokens?: number;
  /** Skip if no team channel and no override. Default true. */
  skipIfNoTeamChannel?: boolean;
}

export interface SpeakAsResult {
  posted: boolean;
  reason?: "no_team_channel" | "skipped" | "ok";
  slack_ts?: string;
  text?: string;
}

/**
 * Generate text in `agent`'s voice from `brief`, then post it as that
 * persona. Logs every step to agent_logs.
 *
 * Returns posted=false (with reason) when the team channel isn't
 * configured and no channel override was given — feature is treated
 * as off-by-default until SLACK_CHANNEL_TEAM is set on Vercel.
 */
export async function speakAs(input: SpeakAsInput): Promise<SpeakAsResult> {
  const channel = input.channel ?? teamChannelOrNull();
  if (!channel) {
    if (input.skipIfNoTeamChannel ?? true) {
      console.log(
        `[team-voice] skip ${input.source} — SLACK_CHANNEL_TEAM not set`,
      );
      await logAgentAction({
        agent: input.agent,
        action: "team.skip",
        metadata: { source: input.source, reason: "no_team_channel" },
        status: "skipped",
      });
      return { posted: false, reason: "no_team_channel" };
    }
    throw new Error("[team-voice] no channel resolved and skip disabled");
  }

  await logAgentAction({
    agent: input.agent,
    action: `team.${input.source}.started`,
    metadata: { brief_length: input.brief.length, channel },
    status: "started",
  });

  const persona = PERSONAS[input.agent];
  const result = await generateText({
    system: PERSONA_PROMPTS[input.agent],
    user:
      `You are speaking as yourself (${persona.firstName}) inside ` +
      `#tamtam-team. Compose a short Slack message — your voice, no ` +
      `quotes, no preamble, no "as ${persona.firstName} I would say". ` +
      `Just the message text exactly as it should appear in Slack.\n\n` +
      `Context: ${input.brief}`,
    maxTokens: input.maxTokens ?? 350,
    temperature: 0.85,
  });

  const text = result.text.trim();
  if (text.length === 0) {
    await logAgentAction({
      agent: input.agent,
      action: `team.${input.source}.empty`,
      metadata: { source: input.source },
      status: "skipped",
    });
    return { posted: false, reason: "skipped" };
  }

  const post = await respondWithTyping({
    agent: input.agent,
    channel,
    threadTs: input.threadTs,
    text,
  });

  await logAgentAction({
    agent: input.agent,
    action: `team.${input.source}.completed`,
    metadata: {
      slack_ts: post.ts,
      tokens: result.outputTokens,
      length: text.length,
    },
    status: "completed",
  });

  return { posted: true, reason: "ok", slack_ts: post.ts, text };
}
