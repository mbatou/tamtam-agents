/**
 * Conversational path for Kofi.
 *
 * When Georges asks Kofi a question in #tamtam-growth that isn't
 * an admin command (no status update, no add-lead, no pipeline
 * snapshot request), the standard agent loop tends to call tools
 * and post a snapshot — wrong UX for "what's your plan for X?".
 *
 * This module bypasses runWithTools entirely. It builds a rich
 * context block (specific lead lookup if a company name appears
 * in the question, pipeline snapshot, recent activity), asks
 * Claude to compose a direct conversational reply in Kofi's
 * voice, and posts immediately to #tamtam-growth.
 */

import { generateText } from "@/lib/anthropic";
import {
  defaultChannelFor,
  postAsAgent,
} from "@/lib/slack";
import {
  findLeadByCompany,
  getPipelineSnapshot,
  getRecentAgentLogs,
  logAgentAction,
} from "@/lib/supabase";
import { GROWTH_SYSTEM_PROMPT } from "./system-prompt";

export interface RespondConversationallyInput {
  text: string;
  channel: string;
  threadTs?: string;
}

export interface RespondConversationallyResult {
  posted: boolean;
  text?: string;
  matched_company?: string | null;
}

/**
 * Best-effort extraction of a company name from a question.
 * Looks for capitalised noun phrases after "for", "about", "from",
 * "on" — false positives are fine because findLeadByCompany returns
 * null gracefully when nothing matches.
 *
 * Examples (extracted name in brackets):
 *   "what is your plan for [Jumia Senegal]?"
 *   "tell me about [Wave]?"
 *   "any thoughts on [Air Sénégal]?"
 */
function extractCompanyName(text: string): string | null {
  // The character class includes Latin-1 supplement + Latin Extended-A
  // so accented French letters (Sénégal, Côte) survive the match.
  const word = "[A-Z][A-Za-z0-9\\u00C0-\\u017F]+";
  const phrase = `${word}(?:\\s+${word})*`;
  const cues = ["for", "about", "from", "on", "with"];
  for (const cue of cues) {
    const re = new RegExp(`\\b${cue}\\s+(${phrase})`, "");
    const m = text.match(re);
    if (m && m[1]) return m[1].trim().replace(/[?.!,;:]+$/, "");
  }
  return null;
}

export async function respondConversationally(
  input: RespondConversationallyInput,
): Promise<RespondConversationallyResult> {
  const companyMatch = extractCompanyName(input.text);
  const lead = companyMatch
    ? await findLeadByCompany(companyMatch).catch(() => null)
    : null;

  const snapshot = await getPipelineSnapshot().catch(() => null);

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [socialLogs, growthLogs] = await Promise.all([
    getRecentAgentLogs("social", since).catch(() => []),
    getRecentAgentLogs("growth", since).catch(() => []),
  ]);

  const leadBlock = lead
    ? `Specific lead in CRM (matched on "${companyMatch}"):
  Company: ${lead.company}
  Status: ${lead.status}
  Contact: ${lead.contact_name ?? "(unknown)"} ${lead.contact_title ? `(${lead.contact_title})` : ""}
  Email: ${lead.email ?? "(none)"}
  Intent signal: ${lead.intent_signal ?? "(none)"}
  Why now (research): ${lead.why_now ?? "(none)"}
  Confidence score: ${lead.confidence_score ?? "—"}
  Awa-warmed: ${lead.awa_warmup ? "yes" : "no"}
  Last contact: ${lead.last_contact_at ?? "never"}
  Notes (truncated): ${(lead.notes ?? "").slice(0, 280)}`
    : companyMatch
      ? `Mentioned company "${companyMatch}" — NOT in CRM yet. Speak from what you know about the brand and Tamtam's ICP fit.`
      : "No specific company referenced in the question.";

  const snapshotBlock = snapshot
    ? `Pipeline snapshot (high-level):
  Hot: ${snapshot.hot.length}, Warm: ${snapshot.warm.length}, Contacted: ${snapshot.contacted.length}, Paused: ${snapshot.paused.length}, Cold: ${snapshot.cold.length}, Converted: ${snapshot.converted.length}
  Apollo: ${snapshot.apollo_credits_used}/75 credits used this month`
    : "(snapshot unavailable)";

  const awaActivityBlock =
    socialLogs.length === 0
      ? "Awa: no recent activity logged in the last 24h."
      : `Awa's recent activity (${socialLogs.length} log rows in 24h). Recent actions:\n` +
        socialLogs.slice(0, 6).map((r) => `  - ${r.action}`).join("\n");

  const growthActivityBlock =
    growthLogs.length === 0
      ? "Your own (Kofi) activity: idle in the last 24h."
      : `Your own (Kofi) recent actions (${growthLogs.length} log rows). Recent:\n` +
        growthLogs.slice(0, 6).map((r) => `  - ${r.action}`).join("\n");

  const result = await generateText({
    system: GROWTH_SYSTEM_PROMPT,
    user:
      `Georges just asked you in #tamtam-growth:\n` +
      `> ${input.text}\n\n` +
      `Answer directly and conversationally in YOUR voice (Kofi). ` +
      `No tool calls. No JSON. No bullet lists unless he ` +
      `genuinely asked for a list. UNDER 80 WORDS. Sound like ` +
      `a colleague answering a question — not a status report.\n\n` +
      `Do NOT post a pipeline snapshot unless he explicitly asked ` +
      `for one. Reference the snapshot data ONLY if it's relevant ` +
      `to the answer. If you have a strategic thought, share it. ` +
      `If a follow-up question is genuinely useful, ask it (one ` +
      `question, not three).\n\n` +
      `Don't say "successfully" / "processed" / "database" / ` +
      `"updated". Sound like a teammate.\n\n` +
      `Context blocks below — use what's relevant, ignore the rest:\n\n` +
      leadBlock +
      "\n\n" +
      snapshotBlock +
      "\n\n" +
      awaActivityBlock +
      "\n\n" +
      growthActivityBlock,
    maxTokens: 350,
    temperature: 0.6,
  });

  const text = result.text.trim();
  if (text.length === 0) {
    await logAgentAction({
      agent: "growth",
      action: "tool.conversational.empty",
      metadata: { text: input.text.slice(0, 200) },
      status: "skipped",
    }).catch(() => undefined);
    return { posted: false, matched_company: companyMatch };
  }

  // Post immediately. Conversational answers don't need the
  // typing-pause UX — Georges is in an active back-and-forth.
  const post = await postAsAgent({
    agent: "growth",
    channel: input.channel,
    threadTs: input.threadTs,
    text,
  });

  await logAgentAction({
    agent: "growth",
    action: "tool.conversational.completed",
    metadata: {
      slack_ts: post.ts,
      matched_company: companyMatch,
      lead_id: lead?.id ?? null,
      tokens: result.outputTokens,
      length: text.length,
    },
    status: "completed",
  }).catch(() => undefined);

  return { posted: true, text, matched_company: companyMatch };
}

/**
 * Detect if a Slack message is a conversational question (deserves
 * a direct answer) rather than an admin command (deserves tool
 * execution) or a normal mention (deserves the agent loop).
 *
 * The patterns lean permissive — caller MUST also ensure
 * `!isAdminCommand(text)` first so admin verbs don't double-route.
 *
 * Note: `/why/i` matches "why" anywhere in the text (including
 * inside "anywhere"). Word boundaries added to the loose patterns
 * to reduce that class of false positive.
 */
export function isConversational(text: string): boolean {
  const conversationalPatterns: ReadonlyArray<RegExp> = [
    /\bwhat is your plan\b/i,
    /\bwhat['']?\s*\w*\s*think\b/i,
    /\bhow\s+\w*\s*approach\b/i,
    /\bshould we\b/i,
    /\bwhat['']?s?\s+(?:the\s+)?strategy\b/i,
    /\btell me about\b/i,
    /\bhow['']?s?\s+(?:it\s+)?going\b/i,
    /\bany thoughts\b/i,
    /\bwhat['']?s?\s+your\s+opinion\b/i,
    /\bwhy\b/i,
  ];
  return conversationalPatterns.some((p) => p.test(text));
}
