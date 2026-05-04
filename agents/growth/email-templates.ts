/**
 * Email-template generators.
 *
 * Three thin wrappers around `generateText` with strict per-stage
 * constraints. Each one returns `{ subject, body }`. The subject /
 * body are NEVER hardcoded — Claude writes them fresh per lead —
 * but the constraint string is rigid so the output stays in shape:
 * sentence count, word ceiling, signature line, no pitch in m1, etc.
 *
 * The generators are pure (no side effects, no Supabase / Resend
 * calls). The kofi-daily-prospecting function composes them with
 * `sendOutreachEmail` + `saveEmailMessage`.
 */

import { generateText } from "@/lib/anthropic";
import { GROWTH_SYSTEM_PROMPT } from "./system-prompt";
import type { Lead } from "@/types";

export interface EmailDraft {
  subject: string;
  body_markdown: string;
}

class EmailDraftParseError extends Error {
  constructor(raw: string) {
    super(`Could not parse email draft as JSON. Raw output:\n${raw}`);
    this.name = "EmailDraftParseError";
  }
}

function parseDraft(raw: string): EmailDraft {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as {
      subject?: unknown;
      body_markdown?: unknown;
    };
    if (
      typeof parsed.subject !== "string" ||
      typeof parsed.body_markdown !== "string"
    ) {
      throw new EmailDraftParseError(raw);
    }
    return { subject: parsed.subject, body_markdown: parsed.body_markdown };
  } catch {
    throw new EmailDraftParseError(raw);
  }
}

function leadProfileBlock(lead: Lead): string {
  return (
    `Lead profile:\n` +
    `  Company: ${lead.company}\n` +
    `  Contact: ${lead.contact_name ?? "(unknown name)"}\n` +
    `  Title: ${lead.contact_title ?? "(unknown title)"}\n` +
    `  Intent signal: ${lead.intent_signal ?? "(none)"}\n` +
    `  Why now: ${lead.why_now ?? "(none)"}\n` +
    `  Awa warmup: ${lead.awa_warmup ? "yes" : "no"}`
  );
}

/* -------------------------------------------------------------------------- */
/*  Day 1 — curiosity question, no pitch                                      */
/* -------------------------------------------------------------------------- */

export async function generateDay1Email(lead: Lead): Promise<EmailDraft> {
  const result = await generateText({
    system: GROWTH_SYSTEM_PROMPT,
    user:
      `Write outreach EMAIL ONE for ${lead.company}. Output JSON: ` +
      `{"subject": string, "body_markdown": string}. No prose around it.\n\n` +
      `Rules — non-negotiable:\n` +
      `  - Subject: ONE specific observation about their brand. ` +
      `    NEVER "Quick question", NEVER "Following up", NEVER ` +
      `    a generic teaser. Lowercase preferred.\n` +
      `  - Body: EXACTLY 3 sentences, ≤ 60 words total.\n` +
      `      sentence 1: a specific observation (their intent signal).\n` +
      `      sentence 2: ONE genuine curiosity question.\n` +
      `      sentence 3: a soft sign-off that does NOT pitch, ` +
      `      NOT mention Tamtam by name unless they already know us, ` +
      `      NOT include a CTA, NOT include a link.\n` +
      `  - Sign-off line at the end of body: "Kofi\\nTamtam — tamma.me"\n` +
      `  - Sound like a peer. Reference something specific about their brand.\n\n` +
      leadProfileBlock(lead),
    maxTokens: 350,
    temperature: 0.5,
  });
  return parseDraft(result.text);
}

/* -------------------------------------------------------------------------- */
/*  Day 4 — Tiak-Tiak proof point, one question                               */
/* -------------------------------------------------------------------------- */

export async function generateDay4Email(input: {
  lead: Lead;
  /** Subject of the day-1 email so day-4 threads as `Re: <subject>`. */
  day1Subject: string | null;
}): Promise<EmailDraft> {
  const reSubject = input.day1Subject
    ? `Use this exact subject: "Re: ${input.day1Subject}".`
    : `Choose a tight subject prefixed with "Re: " (no original to thread).`;

  const result = await generateText({
    system: GROWTH_SYSTEM_PROMPT,
    user:
      `Day-4 follow-up email for ${input.lead.company}. Output JSON: ` +
      `{"subject": string, "body_markdown": string}. No prose.\n\n` +
      `Rules — non-negotiable:\n` +
      `  - ${reSubject}\n` +
      `  - Body ≤ 50 words total.\n` +
      `  - Reference the original briefly (one short clause).\n` +
      `  - Add ONE Tiak-Tiak proof point naturally:\n` +
      `    "We just ran this for Tiak-Tiak — 6,600 clicks in 15 ` +
      `    days at 15 FCFA per click. Worth a quick look?"\n` +
      `  - End with ONE simple question.\n` +
      `  - Sign-off at the end of body: "Kofi\\nTamtam — tamma.me"\n\n` +
      leadProfileBlock(input.lead),
    maxTokens: 280,
    temperature: 0.5,
  });
  return parseDraft(result.text);
}

/* -------------------------------------------------------------------------- */
/*  Day 9 — soft close, door open                                             */
/* -------------------------------------------------------------------------- */

export async function generateDay9Email(input: {
  lead: Lead;
  day1Subject: string | null;
}): Promise<EmailDraft> {
  const reSubject = input.day1Subject
    ? `Use this exact subject: "Re: ${input.day1Subject}".`
    : `Use a tight subject prefixed with "Re: ".`;

  const result = await generateText({
    system: GROWTH_SYSTEM_PROMPT,
    user:
      `Day-9 soft-close email for ${input.lead.company}. Output JSON: ` +
      `{"subject": string, "body_markdown": string}. No prose.\n\n` +
      `Rules — non-negotiable:\n` +
      `  - ${reSubject}\n` +
      `  - Body ≤ 30 words. Warm. NO pressure. Door stays open.\n` +
      `  - Riff on: "If timing isn't right, no worries — we'll be ` +
      `    here when it is."\n` +
      `  - Sign-off: just "Kofi" on the last line (no Tamtam URL — ` +
      `    that was already in the previous emails).`,
    maxTokens: 200,
    temperature: 0.5,
  });
  return parseDraft(result.text);
}
