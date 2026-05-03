/**
 * Inngest function: Kofi runs his autonomous prospecting day.
 *
 * Cron: 0 8 * * 1-6  (08:00 WAT, Monday–Saturday).
 *
 * Steps (each its own step.run so Inngest can checkpoint and the
 * dashboard tells the story):
 *   1. snapshot Awa's last 7 days of content (warmth signal)
 *   2. research 10 leads via Claude (structured JSON output)
 *   3. send LinkedIn connection requests (graceful fallback)
 *   4. send email-1 to leads with verified addresses
 *   5. day-4 follow-ups
 *   6. day-9 follow-ups
 *   7. mark stale leads cold (> 9 days no reply)
 *   8. post the morning brief in #tamtam-growth
 *
 * Honest limitations (documented in code, not buried):
 *   - Lead research is Claude-from-training, not real-time search.
 *     Some "leads" may not exist as real companies. Each lead row
 *     carries metadata.source = "claude_research" so the audit
 *     trail is unambiguous.
 *   - LinkedIn connection requests run via lib/linkedin.ts which
 *     uses the "queued for manual send" fallback until LinkedIn
 *     messaging API approval lands.
 */

import { inngest } from "@/lib/inngest";
import { generateText } from "@/lib/anthropic";
import {
  defaultChannelFor,
  postAsAgent,
} from "@/lib/slack";
import {
  getLeadsNeedingDay4Followup,
  getLeadsNeedingDay9Followup,
  getLeadsToMarkCold,
  getRecentAgentLogs,
  logAgentAction,
  markFollowupSent,
  setLeadStatus,
  upsertLead,
} from "@/lib/supabase";
import { sendConnectionRequest } from "@/lib/linkedin";
import { sendOutreachEmail } from "@/lib/resend";
import OutreachEmail from "@/emails/outreach-template";
import { createElement } from "react";
import { GROWTH_SYSTEM_PROMPT } from "@/agents/growth/system-prompt";
import type {
  Lead,
  LeadInsert,
  LeadOutreachChannel,
} from "@/types";

/* -------------------------------------------------------------------------- */
/*  Lead-research output shape                                                */
/* -------------------------------------------------------------------------- */

interface ResearchedLead {
  company: string;
  contact_name: string | null;
  contact_title: string | null;
  linkedin_url: string | null;
  email: string | null;
  intent_signal: string;
  confidence_score: number;
  awa_warmup: boolean;
  outreach_channel: LeadOutreachChannel;
  why_now: string;
}

function looksLikeLead(x: unknown): x is ResearchedLead {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.company === "string" &&
    typeof o.intent_signal === "string" &&
    typeof o.confidence_score === "number" &&
    typeof o.outreach_channel === "string"
  );
}

function parseLeadsJson(raw: string): ResearchedLead[] {
  // Strip ``` fences if Claude wrapped the JSON.
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Try to find a JSON array embedded in prose.
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(looksLikeLead);
}

/* -------------------------------------------------------------------------- */
/*  Function                                                                  */
/* -------------------------------------------------------------------------- */

export const kofiDailyProspecting = inngest.createFunction(
  {
    id: "kofi-daily-prospecting",
    name: "Kofi — autonomous prospecting day",
  },
  [
    { cron: "0 8 * * 1-6" }, // 08:00 WAT, Mon–Sat
    { event: "tamtam/kofi.prospecting" },
  ],
  async ({ step }) => {
    /* ── 1. Awa's content snapshot ──────────────────────────────────── */
    const awaContext = await step.run("awa-content-snapshot", async () => {
      const since = new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const logs = await getRecentAgentLogs("social", since);
      const publishedActions = logs.filter(
        (r) =>
          r.action === "publish.completed" ||
          r.action === "tool.send_approval_request.completed",
      );
      // The brand a post warmed up isn't stored as a structured field
      // today, so we surface the action trail to Kofi as flavour.
      return {
        since,
        published_count: publishedActions.length,
        recent_actions: publishedActions
          .slice(0, 8)
          .map((r) => ({
            action: r.action,
            metadata: r.metadata,
            created_at: r.created_at,
          })),
      };
    });

    /* ── 2. Research 10 leads via Claude ────────────────────────────── */
    const leadsResearched = await step.run("research-leads", async () => {
      const result = await generateText({
        system: GROWTH_SYSTEM_PROMPT,
        user:
          `Today's prospecting batch. Research 10 Senegalese brands ` +
          `that match Tamtam's ICP. Apply the Gojiberry intent ` +
          `signal framework:\n` +
          `  Priority 1: brands Awa has published content about\n` +
          `  Priority 2: brands showing buying signals (new ` +
          `product launch, recent funding, hiring marketing roles, ` +
          `Facebook Ads frustration, competitors of existing ` +
          `Tamtam clients)\n` +
          `  Priority 3: cold ICP matches (FMCG / fintech / ` +
          `e-commerce / telecom in Senegal) with no signal yet\n\n` +
          `Awa's last 7 days of social activity:\n` +
          JSON.stringify(awaContext, null, 2) +
          `\n\nReturn ONLY a JSON array of EXACTLY 10 leads — no ` +
          `prose, no preamble, no markdown fences. Each lead is an ` +
          `object with these exact keys:\n` +
          `{\n` +
          `  "company": string,\n` +
          `  "contact_name": string | null,\n` +
          `  "contact_title": string | null,\n` +
          `  "linkedin_url": string | null,\n` +
          `  "email": string | null,\n` +
          `  "intent_signal": string,\n` +
          `  "confidence_score": number (0-100),\n` +
          `  "awa_warmup": boolean,\n` +
          `  "outreach_channel": "linkedin" | "email" | "both",\n` +
          `  "why_now": string\n` +
          `}\n\n` +
          `Be honest about confidence. Do not invent specific ` +
          `email addresses you cannot verify — set email: null and ` +
          `outreach_channel: "linkedin" if you only have a profile ` +
          `URL. If you cannot verify a contact_name, set it to null.`,
        maxTokens: 3500,
        temperature: 0.4,
      });

      const parsed = parseLeadsJson(result.text);

      const persisted: Lead[] = [];
      for (const r of parsed) {
        const insert: LeadInsert = {
          company: r.company,
          contact_name: r.contact_name,
          contact_title: r.contact_title,
          email: r.email,
          status: "researched",
          last_contact_at: null,
          notes: `Research source: claude_research (${new Date().toISOString()}).`,
          intent_signal: r.intent_signal,
          confidence_score: r.confidence_score,
          awa_warmup: !!r.awa_warmup,
          outreach_channel: r.outreach_channel,
          why_now: r.why_now,
          linkedin_url: r.linkedin_url,
          linkedin_message_id: null,
          day4_sent_at: null,
          day9_sent_at: null,
          response_classification: null,
          escalated_to_georges: false,
          escalated_at: null,
        };
        try {
          const lead = await upsertLead(insert);
          persisted.push(lead);
        } catch (err) {
          await logAgentAction({
            agent: "growth",
            action: "kofi.research.lead_persist_failed",
            metadata: {
              company: r.company,
              error: err instanceof Error ? err.message : String(err),
            },
            status: "failed",
          });
        }
      }

      await logAgentAction({
        agent: "growth",
        action: "kofi.research.completed",
        metadata: {
          requested: 10,
          parsed: parsed.length,
          persisted: persisted.length,
          tokens: result.outputTokens,
        },
        status: "completed",
      });

      return persisted;
    });

    /* ── 3. LinkedIn connection requests ────────────────────────────── */
    const connectionResults = await step.run(
      "send-connection-requests",
      async () => {
        const results: Array<{
          lead_id: string;
          mode: "real" | "fallback" | "skipped";
        }> = [];
        for (const lead of leadsResearched) {
          if (
            lead.outreach_channel !== "linkedin" &&
            lead.outreach_channel !== "both"
          ) {
            continue;
          }
          if (!lead.linkedin_url) {
            results.push({ lead_id: lead.id, mode: "skipped" });
            continue;
          }
          const noteRes = await generateText({
            system: GROWTH_SYSTEM_PROMPT,
            user:
              `Write a LinkedIn connection request note for ` +
              `${lead.company}${
                lead.contact_name ? ` (${lead.contact_name})` : ""
              }. ` +
              `MAX 20 words. Reference one specific thing about ` +
              `their brand. NO pitch. Sound like a peer. Output ` +
              `the note text only — no quotes, no preamble.\n\n` +
              `Intent signal: ${lead.intent_signal ?? "(none)"}\n` +
              `Why now: ${lead.why_now ?? "(none)"}`,
            maxTokens: 80,
            temperature: 0.6,
          });
          const note = noteRes.text.trim().replace(/^["']|["']$/g, "");
          const sent = await sendConnectionRequest({
            profileUrl: lead.linkedin_url,
            note,
            company: lead.company,
          });
          results.push({ lead_id: lead.id, mode: sent.mode });
        }
        return results;
      },
    );

    /* ── 4. Email-1 (curiosity question only, no pitch) ─────────────── */
    const emailResults = await step.run("send-email-1", async () => {
      const results: Array<{
        lead_id: string;
        mode: "sent" | "skipped";
        reason?: string;
      }> = [];
      for (const lead of leadsResearched) {
        if (
          lead.outreach_channel !== "email" &&
          lead.outreach_channel !== "both"
        ) {
          continue;
        }
        if (!lead.email) {
          results.push({ lead_id: lead.id, mode: "skipped", reason: "no_email" });
          continue;
        }

        const draft = await generateText({
          system: GROWTH_SYSTEM_PROMPT,
          user:
            `Write outreach EMAIL ONE for ${lead.company}. Output ` +
            `JSON: {"subject": string, "body_markdown": string}. ` +
            `No prose around it.\n\n` +
            `Rules — non-negotiable:\n` +
            `  - Subject ≤ 7 words, lowercase, no clickbait, ONE ` +
            `    specific observation about their brand.\n` +
            `  - Body: EXACTLY 3 sentences.\n` +
            `      sentence 1: a specific observation (their intent ` +
            `      signal).\n` +
            `      sentence 2: ONE genuine curiosity question.\n` +
            `      sentence 3: a soft sign-off line that does NOT ` +
            `      pitch, NOT mention Tamtam by name unless they ` +
            `      already know us, NOT include a CTA, NOT include ` +
            `      a link.\n` +
            `  - Sign as "Kofi" (Tamtam comes later).\n\n` +
            `Lead profile:\n` +
            `  Company: ${lead.company}\n` +
            `  Contact: ${lead.contact_name ?? "(unknown name)"}\n` +
            `  Title: ${lead.contact_title ?? "(unknown title)"}\n` +
            `  Intent signal: ${lead.intent_signal ?? "(none)"}\n` +
            `  Why now: ${lead.why_now ?? "(none)"}\n` +
            `  Awa warmup: ${lead.awa_warmup ? "yes" : "no"}`,
          maxTokens: 350,
          temperature: 0.5,
        });

        let parsed: { subject: string; body_markdown: string };
        try {
          parsed = JSON.parse(
            draft.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""),
          );
        } catch {
          results.push({
            lead_id: lead.id,
            mode: "skipped",
            reason: "draft_parse_failed",
          });
          continue;
        }

        const firstName = lead.contact_name?.split(/\s+/)[0] ?? null;
        try {
          await sendOutreachEmail({
            to: lead.email,
            subject: parsed.subject,
            template: createElement(OutreachEmail, {
              recipientFirstName: firstName,
              bodyMarkdown: parsed.body_markdown,
              signatureName: "Kofi",
              signatureTitle: "Growth",
              signatureCompany: "Tamtam",
              preview: parsed.subject,
            }),
            text: parsed.body_markdown,
          });
          await setLeadStatus(lead.id, "contacted", {
            lastContactAt: new Date().toISOString(),
          });
          results.push({ lead_id: lead.id, mode: "sent" });
        } catch (err) {
          await logAgentAction({
            agent: "growth",
            action: "kofi.email_1.failed",
            metadata: {
              lead_id: lead.id,
              error: err instanceof Error ? err.message : String(err),
            },
            status: "failed",
          });
          results.push({
            lead_id: lead.id,
            mode: "skipped",
            reason: "send_failed",
          });
        }
      }
      return results;
    });

    /* ── 5. Day-4 follow-ups ─────────────────────────────────────────── */
    const day4 = await step.run("day-4-followups", async () => {
      const dueLeads = await getLeadsNeedingDay4Followup();
      const sent: string[] = [];
      for (const lead of dueLeads) {
        if (!lead.email) continue;
        const draft = await generateText({
          system: GROWTH_SYSTEM_PROMPT,
          user:
            `Day-4 follow-up for ${lead.company}. Output JSON: ` +
            `{"subject": string, "body_markdown": string}.\n` +
            `Rules: ≤ 40 words total body. Reference their specific ` +
            `situation. Add ONE piece of social proof — Tiak-Tiak ` +
            `early results (e.g. "we recently helped a Senegalese ` +
            `fintech reach 1,000+ Échos at 43 FCFA per click"). ` +
            `End with one simple question. Subject can be a Re: of ` +
            `the original — pick a tight one.\n\n` +
            `Lead: ${lead.company} — ${lead.intent_signal ?? "no signal"}\n` +
            `Original notes: ${lead.notes ?? "(none)"}`,
          maxTokens: 250,
          temperature: 0.5,
        });
        let parsed: { subject: string; body_markdown: string };
        try {
          parsed = JSON.parse(
            draft.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""),
          );
        } catch {
          continue;
        }
        const firstName = lead.contact_name?.split(/\s+/)[0] ?? null;
        try {
          await sendOutreachEmail({
            to: lead.email,
            subject: parsed.subject,
            template: createElement(OutreachEmail, {
              recipientFirstName: firstName,
              bodyMarkdown: parsed.body_markdown,
              signatureName: "Kofi",
              signatureTitle: "Growth",
              signatureCompany: "Tamtam",
              preview: parsed.subject,
            }),
            text: parsed.body_markdown,
          });
          await markFollowupSent({ leadId: lead.id, which: "day4" });
          sent.push(lead.id);
        } catch (err) {
          await logAgentAction({
            agent: "growth",
            action: "kofi.day4.failed",
            metadata: {
              lead_id: lead.id,
              error: err instanceof Error ? err.message : String(err),
            },
            status: "failed",
          });
        }
      }
      return { due: dueLeads.length, sent: sent.length };
    });

    /* ── 6. Day-9 follow-ups ─────────────────────────────────────────── */
    const day9 = await step.run("day-9-followups", async () => {
      const dueLeads = await getLeadsNeedingDay9Followup();
      const sent: string[] = [];
      for (const lead of dueLeads) {
        if (!lead.email) continue;
        const draft = await generateText({
          system: GROWTH_SYSTEM_PROMPT,
          user:
            `Day-9 soft-close follow-up for ${lead.company}. Output ` +
            `JSON: {"subject": string, "body_markdown": string}.\n` +
            `Rules: ≤ 25 words total body. Warm. NO pressure. Door ` +
            `stays open. Riff on "if the timing isn't right, no ` +
            `worries — we'll be here when it is."`,
          maxTokens: 200,
          temperature: 0.5,
        });
        let parsed: { subject: string; body_markdown: string };
        try {
          parsed = JSON.parse(
            draft.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""),
          );
        } catch {
          continue;
        }
        const firstName = lead.contact_name?.split(/\s+/)[0] ?? null;
        try {
          await sendOutreachEmail({
            to: lead.email,
            subject: parsed.subject,
            template: createElement(OutreachEmail, {
              recipientFirstName: firstName,
              bodyMarkdown: parsed.body_markdown,
              signatureName: "Kofi",
              signatureTitle: "Growth",
              signatureCompany: "Tamtam",
              preview: parsed.subject,
            }),
            text: parsed.body_markdown,
          });
          await markFollowupSent({ leadId: lead.id, which: "day9" });
          sent.push(lead.id);
        } catch (err) {
          await logAgentAction({
            agent: "growth",
            action: "kofi.day9.failed",
            metadata: {
              lead_id: lead.id,
              error: err instanceof Error ? err.message : String(err),
            },
            status: "failed",
          });
        }
      }
      return { due: dueLeads.length, sent: sent.length };
    });

    /* ── 7. Mark stale leads cold (> 9 days no reply) ────────────────── */
    const cold = await step.run("mark-cold", async () => {
      const stale = await getLeadsToMarkCold();
      for (const lead of stale) {
        await setLeadStatus(lead.id, "cold").catch(() => undefined);
      }
      return { marked_cold: stale.length };
    });

    /* ── 8. Morning brief in #tamtam-growth ─────────────────────────── */
    await step.run("morning-brief", async () => {
      const topLeads = leadsResearched.slice(0, 3).map((l) => ({
        company: l.company,
        why_now: l.why_now,
        confidence: l.confidence_score,
        awa_warmup: l.awa_warmup,
      }));
      const connectionsSent = connectionResults.filter(
        (r) => r.mode !== "skipped",
      ).length;
      const emailsSent = emailResults.filter((r) => r.mode === "sent").length;

      const briefRes = await generateText({
        system: GROWTH_SYSTEM_PROMPT,
        user:
          `Compose your morning brief for #tamtam-growth in your voice ` +
          `(Kofi). Output the message text only — no preamble, no ` +
          `quotes. Use the data below. Keep the structure but write ` +
          `it like a real human, not a template. Address Georges ` +
          `directly at the end.\n\n` +
          `Format target:\n` +
          `Morning. Here's what I'm working on today:\n\n` +
          `📍 New leads researched: ${leadsResearched.length}\n` +
          `   → top picks with one line each\n\n` +
          `📧 Outreach sent: ${
            connectionsSent + emailsSent
          } total (${emailsSent} emails, ${connectionsSent} LinkedIn)\n\n` +
          `🔄 Follow-ups: ${day4.sent} day-4s, ${day9.sent} day-9s\n\n` +
          `🌡️ Pipeline temperature: short read on warmth\n\n` +
          `Georges — one specific thing for him, or "nothing urgent, ` +
          `I've got it"\n\n` +
          `Top 3 leads:\n${JSON.stringify(topLeads, null, 2)}\n` +
          `Cold-marked today: ${cold.marked_cold}`,
        maxTokens: 600,
        temperature: 0.5,
      });

      await postAsAgent({
        agent: "growth",
        channel: defaultChannelFor("growth"),
        text: briefRes.text.trim(),
      });
    });

    return {
      leads_researched: leadsResearched.length,
      connections_attempted: connectionResults.length,
      emails_sent: emailResults.filter((r) => r.mode === "sent").length,
      day4_sent: day4.sent,
      day9_sent: day9.sent,
      marked_cold: cold.marked_cold,
    };
  },
);
