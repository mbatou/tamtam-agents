/**
 * Inngest function: Kofi runs his autonomous prospecting day.
 *
 * Cron: 0 8 * * 1-6  (08:00 WAT, Monday–Saturday).
 *
 * Steps (each its own step.run so Inngest checkpoints cleanly):
 *   1. snapshot Awa's last 7 days of content (warmth signal)
 *   2. research 10 leads via Claude (structured JSON output;
 *      every lead carries notes "Source: claude_research" plus
 *      a verify-before-trusting marker — these are AI-generated
 *      profiles, not real-time-verified)
 *   3. Apollo enrichment of TOP 3 high-confidence leads (≥ 70),
 *      credit-aware: skip entirely when remaining < 5 and post
 *      a warning in #tamtam-growth. Updates only the leads where
 *      Apollo returns a usable email — those are flagged
 *      verified=true via metadata + outreach_channel='email'.
 *   4. day-1 emails sent ONLY to verified leads (email field
 *      populated AND notes carry "verified=true" flag).
 *      Unverified leads land in the "needs verification" batch
 *      surfaced in the morning brief — Georges supplies contacts
 *      he knows; Kofi adds them tomorrow.
 *   5. day-4 follow-ups (Tiak-Tiak proof, ≤ 50 words)
 *   6. day-9 follow-ups (soft close, ≤ 30 words)
 *   7. cold cleanup (status=cold for stale > 9 day silence)
 *   8. morning brief in #tamtam-growth with Apollo credit count
 *
 * Every outbound send writes to email_messages so day-4 / day-9
 * can thread the original subject. Resend message id is captured
 * on every row — when Resend Inbound is wired, replies will join
 * naturally on resend_message_id.
 */

import { inngest } from "@/lib/inngest";
import { generateText } from "@/lib/anthropic";
import {
  defaultChannelFor,
  postAsAgent,
} from "@/lib/slack";
import {
  getLastOutboundEmailToLead,
  getLeadsNeedingDay4Followup,
  getLeadsNeedingDay9Followup,
  getLeadsToMarkCold,
  getRecentAgentLogs,
  logAgentAction,
  markFollowupSent,
  saveEmailMessage,
  setLeadStatus,
  upsertLead,
} from "@/lib/supabase";
import {
  getCreditsRemaining,
  looksLikeRealEmail,
  revealPerson,
  searchPeople,
} from "@/lib/apollo";
import { sendOutreachEmail } from "@/lib/resend";
import OutreachEmail from "@/emails/outreach-template";
import { createElement } from "react";
import { GROWTH_SYSTEM_PROMPT } from "@/agents/growth/system-prompt";
import {
  generateDay1Email,
  generateDay4Email,
  generateDay9Email,
} from "@/agents/growth/email-templates";
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
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
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

const APOLLO_TOP_N = 3;
// Threshold lowered from 70 → 50: Claude-generated leads
// rarely score above 70 because they have no real signal data
// behind them. With the 5-credit buffer + APOLLO_TOP_N=3 cap,
// we still spend ≤ 3 credits/day on this step.
const APOLLO_MIN_SCORE = 50;
const APOLLO_LOW_CREDIT_BUFFER = 5;

export const kofiDailyProspecting = inngest.createFunction(
  {
    id: "kofi-daily-prospecting",
    name: "Kofi — autonomous prospecting day",
  },
  [
    { cron: "0 8 * * 1-6" },
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
          notes:
            `Source: claude_research (${new Date().toISOString()}).\n` +
            `AI-generated profile — verify before trusting.`,
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

    /* ── 3. Apollo enrichment of top-N high-confidence leads ───────── */
    const enrichmentReport = await step.run(
      "apollo-enrich",
      async () => {
        const remaining = await getCreditsRemaining();
        if (remaining < APOLLO_LOW_CREDIT_BUFFER) {
          await postAsAgent({
            agent: "growth",
            channel: defaultChannelFor("growth"),
            text:
              `:warning: Apollo credits nearly exhausted for this ` +
              `month (${Math.max(0, remaining)} remaining of 70 ` +
              `usable). Email enrichment paused until the first of ` +
              `next month.`,
          }).catch(() => undefined);
          await logAgentAction({
            agent: "growth",
            action: "kofi.apollo.skipped_low_credits",
            metadata: { remaining },
            status: "skipped",
          });
          return {
            attempted: 0,
            verified: 0,
            credits_used_this_run: 0,
            credits_remaining_after: remaining,
            verified_lead_ids: [] as string[],
          };
        }

        // Per-lead decision logs (visible in Vercel logs).
        for (const lead of leadsResearched) {
          const score = lead.confidence_score ?? 0;
          console.log(
            `[apollo] lead score: ${score} for "${lead.company}" — ${
              score >= APOLLO_MIN_SCORE
                ? "attempting enrichment"
                : "below threshold, skipping"
            }`,
          );
        }

        // Highest-confidence leads first; limit to APOLLO_TOP_N
        // and only those at or above the score threshold.
        const candidates = [...leadsResearched]
          .filter((l) => (l.confidence_score ?? 0) >= APOLLO_MIN_SCORE)
          .sort(
            (a, b) =>
              (b.confidence_score ?? 0) - (a.confidence_score ?? 0),
          )
          .slice(0, APOLLO_TOP_N);

        console.log(
          `[apollo] enriching top ${candidates.length} of ${leadsResearched.length} leads ` +
            `(threshold ≥ ${APOLLO_MIN_SCORE}, cap ${APOLLO_TOP_N})`,
        );

        let verified = 0;
        const verifiedIds: string[] = [];
        for (const lead of candidates) {
          const search = await searchPeople({
            company: lead.company,
            titles: [
              "Marketing Director",
              "Brand Manager",
              "CEO",
              "Fondateur",
              "Directeur Marketing",
              "Head of Growth",
            ],
            locations: ["Senegal", "Dakar"],
          });

          // Resolve the email from search; if missing or obfuscated,
          // fall back to a /people/match reveal call (1 extra credit).
          // This adds up at scale — only call when truly needed.
          let resolved = search;
          if (search && !looksLikeRealEmail(search.email)) {
            console.log(
              `[apollo] search returned no usable email for "${lead.company}" — calling revealPerson`,
            );
            const revealed = await revealPerson({
              personId: search.id,
              name: search.name,
              organizationName: lead.company,
            });
            if (revealed) {
              resolved = {
                id: revealed.id ?? search.id,
                name: revealed.name ?? search.name,
                title: revealed.title ?? search.title,
                email: looksLikeRealEmail(revealed.email)
                  ? revealed.email
                  : search.email,
                linkedin_url: revealed.linkedin_url ?? search.linkedin_url,
              };
            }
          }

          if (resolved && looksLikeRealEmail(resolved.email)) {
            await upsertLead({
              company: lead.company,
              email: resolved.email,
              contact_name: resolved.name ?? lead.contact_name,
              contact_title: resolved.title ?? lead.contact_title,
              linkedin_url: resolved.linkedin_url ?? lead.linkedin_url,
              status: lead.status,
              outreach_channel: "email",
              notes:
                (lead.notes ? lead.notes + "\n\n" : "") +
                `[${new Date().toISOString()}] Apollo verified — ` +
                `email + contact resolved. Source: apollo.`,
              intent_signal: lead.intent_signal,
              confidence_score: lead.confidence_score,
              awa_warmup: lead.awa_warmup,
              why_now: lead.why_now,
            });
            verified += 1;
            verifiedIds.push(lead.id);
            console.log(
              `[apollo] verified ${lead.company} → ${resolved.email}`,
            );
          } else {
            console.log(
              `[apollo] no usable email for ${lead.company} — left unverified`,
            );
          }
        }

        const remainingAfter = await getCreditsRemaining();
        await logAgentAction({
          agent: "growth",
          action: "kofi.apollo.batch_completed",
          metadata: {
            attempted: candidates.length,
            verified,
            credits_remaining_after: remainingAfter,
          },
          status: "completed",
        });

        return {
          attempted: candidates.length,
          verified,
          credits_used_this_run: candidates.length, // each search costs 1
          credits_remaining_after: remainingAfter,
          verified_lead_ids: verifiedIds,
        };
      },
    );

    /* ── 4. Day-1 emails — verified leads only ──────────────────────── */
    const day1Results = await step.run("send-day-1-emails", async () => {
      const sent: Array<{ lead_id: string; company: string }> = [];
      const skipped_unverified: Array<{ lead_id: string; company: string }> =
        [];

      for (const lead of leadsResearched) {
        const isVerified = enrichmentReport.verified_lead_ids.includes(
          lead.id,
        );
        // Only Apollo-verified leads OR Georges-supplied (added via
        // add_manual_lead earlier) get a day-1 send. The latter
        // arrive with status='researched' AND email present, but we
        // can't distinguish them from raw claude_research leads at
        // this point — so we rely on Apollo verification here. The
        // morning brief surfaces unverified leads to Georges.
        if (!isVerified || !lead.email) {
          skipped_unverified.push({
            lead_id: lead.id,
            company: lead.company,
          });
          continue;
        }

        let draft;
        try {
          draft = await generateDay1Email(lead);
        } catch (err) {
          await logAgentAction({
            agent: "growth",
            action: "kofi.day1.draft_failed",
            metadata: {
              lead_id: lead.id,
              error: err instanceof Error ? err.message : String(err),
            },
            status: "failed",
          });
          continue;
        }

        const firstName = lead.contact_name?.split(/\s+/)[0] ?? null;
        try {
          const emailRes = await sendOutreachEmail({
            to: lead.email,
            subject: draft.subject,
            template: createElement(OutreachEmail, {
              recipientFirstName: firstName,
              bodyMarkdown: draft.body_markdown,
              signatureName: "Kofi",
              signatureTitle: "Growth",
              signatureCompany: "Tamtam",
              preview: draft.subject,
            }),
            text: draft.body_markdown,
          });
          await saveEmailMessage({
            lead_id: lead.id,
            direction: "outbound",
            subject: draft.subject,
            body: draft.body_markdown,
            resend_message_id: emailRes.id,
            email_type: "day1",
          });
          await setLeadStatus(lead.id, "contacted", {
            lastContactAt: new Date().toISOString(),
          });
          sent.push({ lead_id: lead.id, company: lead.company });
        } catch (err) {
          await logAgentAction({
            agent: "growth",
            action: "kofi.day1.send_failed",
            metadata: {
              lead_id: lead.id,
              error: err instanceof Error ? err.message : String(err),
            },
            status: "failed",
          });
        }
      }

      return { sent, skipped_unverified };
    });

    /* ── 5. Day-4 follow-ups ─────────────────────────────────────────── */
    const day4 = await step.run("day-4-followups", async () => {
      const due = await getLeadsNeedingDay4Followup();
      const sent: string[] = [];
      for (const lead of due) {
        if (!lead.email) continue;
        const prior = await getLastOutboundEmailToLead(lead.id);
        let draft;
        try {
          draft = await generateDay4Email({
            lead,
            day1Subject: prior?.subject ?? null,
          });
        } catch {
          continue;
        }
        const firstName = lead.contact_name?.split(/\s+/)[0] ?? null;
        try {
          const emailRes = await sendOutreachEmail({
            to: lead.email,
            subject: draft.subject,
            template: createElement(OutreachEmail, {
              recipientFirstName: firstName,
              bodyMarkdown: draft.body_markdown,
              signatureName: "Kofi",
              signatureTitle: "Growth",
              signatureCompany: "Tamtam",
              preview: draft.subject,
            }),
            text: draft.body_markdown,
          });
          await saveEmailMessage({
            lead_id: lead.id,
            direction: "outbound",
            subject: draft.subject,
            body: draft.body_markdown,
            resend_message_id: emailRes.id,
            email_type: "day4",
          });
          await markFollowupSent({ leadId: lead.id, which: "day4" });
          sent.push(lead.id);
        } catch (err) {
          await logAgentAction({
            agent: "growth",
            action: "kofi.day4.send_failed",
            metadata: {
              lead_id: lead.id,
              error: err instanceof Error ? err.message : String(err),
            },
            status: "failed",
          });
        }
      }
      return { due: due.length, sent: sent.length };
    });

    /* ── 6. Day-9 follow-ups ─────────────────────────────────────────── */
    const day9 = await step.run("day-9-followups", async () => {
      const due = await getLeadsNeedingDay9Followup();
      const sent: string[] = [];
      for (const lead of due) {
        if (!lead.email) continue;
        const prior = await getLastOutboundEmailToLead(lead.id);
        let draft;
        try {
          draft = await generateDay9Email({
            lead,
            day1Subject: prior?.subject ?? null,
          });
        } catch {
          continue;
        }
        const firstName = lead.contact_name?.split(/\s+/)[0] ?? null;
        try {
          const emailRes = await sendOutreachEmail({
            to: lead.email,
            subject: draft.subject,
            template: createElement(OutreachEmail, {
              recipientFirstName: firstName,
              bodyMarkdown: draft.body_markdown,
              signatureName: "Kofi",
              signatureTitle: "Growth",
              signatureCompany: "Tamtam",
              preview: draft.subject,
            }),
            text: draft.body_markdown,
          });
          await saveEmailMessage({
            lead_id: lead.id,
            direction: "outbound",
            subject: draft.subject,
            body: draft.body_markdown,
            resend_message_id: emailRes.id,
            email_type: "day9",
          });
          await markFollowupSent({ leadId: lead.id, which: "day9" });
          sent.push(lead.id);
        } catch (err) {
          await logAgentAction({
            agent: "growth",
            action: "kofi.day9.send_failed",
            metadata: {
              lead_id: lead.id,
              error: err instanceof Error ? err.message : String(err),
            },
            status: "failed",
          });
        }
      }
      return { due: due.length, sent: sent.length };
    });

    /* ── 7. Cold cleanup ─────────────────────────────────────────────── */
    const cold = await step.run("mark-cold", async () => {
      const stale = await getLeadsToMarkCold();
      for (const lead of stale) {
        await setLeadStatus(lead.id, "cold").catch(() => undefined);
      }
      return { marked_cold: stale.length };
    });

    /* ── 8. Morning brief in #tamtam-growth ──────────────────────────── */
    await step.run("morning-brief", async () => {
      const topLeads = leadsResearched.slice(0, 3).map((l) => ({
        company: l.company,
        why_now: l.why_now,
        confidence: l.confidence_score,
        awa_warmup: l.awa_warmup,
      }));

      const briefRes = await generateText({
        system: GROWTH_SYSTEM_PROMPT,
        user:
          `Compose your morning brief for #tamtam-growth in your voice ` +
          `(Kofi). Output the message text only — no preamble, no ` +
          `quotes. Use the data below. Keep the structure but write ` +
          `it like a real human, not a template. Address Georges ` +
          `directly at the end.\n\n` +
          `Format target:\n` +
          `Morning. Here's the pipeline:\n\n` +
          `🔍 New leads researched: ${leadsResearched.length}\n` +
          `   → top 3 with company + why_now + score\n\n` +
          `✅ Apollo verified: ${enrichmentReport.verified} / ` +
          `${enrichmentReport.attempted} attempted\n` +
          `   Credits used this month: ${
            70 - enrichmentReport.credits_remaining_after
          } / 70 (5-credit safety buffer)\n\n` +
          `📧 Emails sent today: ${day1Results.sent.length}\n` +
          `   → company names\n\n` +
          `🔄 Follow-ups: ${day4.sent} day-4s, ${day9.sent} day-9s\n\n` +
          `🌡️ Pipeline:\n` +
          `   Active (contacted): from snapshot\n` +
          `   Cold (archived today): ${cold.marked_cold}\n\n` +
          `📋 Needs email verification:\n` +
          `   ${
            day1Results.skipped_unverified.length
          } companies — list them, then ask Georges to drop any ` +
          `contacts he knows.\n\n` +
          `Georges — one specific thing for him, or "all clear".\n\n` +
          `Top 3 leads:\n${JSON.stringify(topLeads, null, 2)}\n\n` +
          `Sent today:\n${JSON.stringify(day1Results.sent, null, 2)}\n\n` +
          `Needs verification:\n${JSON.stringify(
            day1Results.skipped_unverified,
            null,
            2,
          )}`,
        maxTokens: 700,
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
      apollo_attempted: enrichmentReport.attempted,
      apollo_verified: enrichmentReport.verified,
      apollo_credits_remaining_after: enrichmentReport.credits_remaining_after,
      day1_sent: day1Results.sent.length,
      day1_skipped_unverified: day1Results.skipped_unverified.length,
      day4_sent: day4.sent,
      day9_sent: day9.sent,
      marked_cold: cold.marked_cold,
    };
  },
);
