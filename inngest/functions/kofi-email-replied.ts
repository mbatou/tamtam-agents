/**
 * Inngest function: classify a Kofi email reply and act.
 *
 * Triggered by tamtam/kofi.email-replied (emitted by
 * /api/webhooks/email-reply). Steps:
 *   1. classify reply text via Claude → positive | neutral |
 *      negative | referral
 *   2. update the lead (or log if no matching lead)
 *   3. on 'positive': mark warm + DM Georges with full context
 *      using the Slack escalation template
 *   4. on 'neutral': leave at 'contacted', let cadence continue
 *   5. on 'negative': mark 'rejected', stop outreach
 *   6. on 'referral': append a note (no automatic new-lead row;
 *      Kofi flags it for Georges to confirm)
 */

import { inngest } from "@/lib/inngest";
import { generateText } from "@/lib/anthropic";
import { dmGeorges } from "@/lib/slack";
import {
  findLeadByEmail,
  getLead,
  logAgentAction,
  markLeadEscalated,
  setLeadResponseClassification,
} from "@/lib/supabase";
import { GROWTH_SYSTEM_PROMPT } from "@/agents/growth/system-prompt";
import type { Lead, LeadResponseClassification } from "@/types";

interface ClassifierOutput {
  classification: LeadResponseClassification;
  read: string;
  next_step: string;
  confidence: number;
}

function parseClassifier(raw: string): ClassifierOutput | null {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const cls = parsed.classification;
    if (
      cls !== "positive" &&
      cls !== "neutral" &&
      cls !== "negative" &&
      cls !== "referral"
    ) {
      return null;
    }
    return {
      classification: cls,
      read: typeof parsed.read === "string" ? parsed.read : "",
      next_step:
        typeof parsed.next_step === "string" ? parsed.next_step : "",
      confidence:
        typeof parsed.confidence === "number" ? parsed.confidence : 0,
    };
  } catch {
    return null;
  }
}

export const kofiEmailReplied = inngest.createFunction(
  {
    id: "kofi-email-replied",
    name: "Kofi — classify email reply + escalate if positive",
    concurrency: { limit: 1, key: "event.data.from_email" },
  },
  { event: "tamtam/kofi.email-replied" },
  async ({ event, step }) => {
    const { lead_id, from_email, subject, text } = event.data;

    /* ── 1. Resolve the lead ─────────────────────────────────────────── */
    const lead: Lead | null = await step.run("resolve-lead", async () => {
      if (lead_id) return getLead(lead_id).catch(() => null);
      return findLeadByEmail(from_email);
    });

    /* ── 2. Classify the reply ───────────────────────────────────────── */
    const result = await step.run("classify", async () =>
      generateText({
        system: GROWTH_SYSTEM_PROMPT,
        user:
          `An inbound email reply just arrived. Classify it strictly. ` +
          `Output ONLY this JSON, no prose:\n` +
          `{\n` +
          `  "classification": "positive" | "neutral" | "negative" | "referral",\n` +
          `  "read": string (one-sentence Kofi-voice assessment),\n` +
          `  "next_step": string (one specific recommendation),\n` +
          `  "confidence": number 0-100\n` +
          `}\n\n` +
          `Definitions:\n` +
          `  positive  = interested, asking questions, open to learning more\n` +
          `  neutral   = polite but not engaged\n` +
          `  negative  = not interested, wrong person, wrong timing\n` +
          `  referral  = redirected you to someone else\n\n` +
          `From: ${from_email}\n` +
          `Subject: ${subject}\n` +
          `Body:\n${text.slice(0, 3000)}` +
          (lead
            ? `\n\nLead context: ${lead.company} (${lead.intent_signal ?? "no signal"})`
            : `\n\nNo matching lead in CRM.`),
        maxTokens: 350,
        temperature: 0.2,
      }),
    );

    const parsed = parseClassifier(result.text);
    if (!parsed) {
      await step.run("classification-parse-failed", async () =>
        logAgentAction({
          agent: "growth",
          action: "kofi.email_reply.parse_failed",
          metadata: {
            from_email,
            subject,
            raw_first_chars: result.text.slice(0, 200),
          },
          status: "failed",
        }),
      );
      return { ok: false, reason: "classification_parse_failed" };
    }

    /* ── 3. Update lead status by classification ─────────────────────── */
    const newStatus: Lead["status"] =
      parsed.classification === "positive"
        ? "warm"
        : parsed.classification === "negative"
          ? "rejected"
          : parsed.classification === "referral"
            ? "contacted" // referrer kept in pipeline
            : "contacted"; // neutral

    if (lead) {
      await step.run("persist-classification", async () =>
        setLeadResponseClassification({
          leadId: lead.id,
          classification: parsed.classification,
          status: newStatus,
          responseNote: text.slice(0, 800),
        }),
      );
    } else {
      await step.run("log-orphan-reply", async () =>
        logAgentAction({
          agent: "growth",
          action: "kofi.email_reply.orphan",
          metadata: {
            from_email,
            subject,
            classification: parsed.classification,
          },
          status: "completed",
        }),
      );
    }

    /* ── 4. On positive: DM Georges and mark escalated ───────────────── */
    if (parsed.classification === "positive") {
      await step.run("escalate-to-georges", async () => {
        const company = lead?.company ?? from_email;
        const dmText =
          `Georges — ${company} just responded.\n\n` +
          `*What they said:*\n> ${text.slice(0, 500).replace(/\n/g, "\n> ")}\n\n` +
          `*My read:* ${parsed.read}\n\n` +
          `*Confidence:* ${parsed.confidence}/100\n\n` +
          `*Suggested next step:* ${parsed.next_step}\n\n` +
          `Ready to move when you are.`;
        const res = await dmGeorges({ agent: "growth", text: dmText });

        if (lead) {
          await markLeadEscalated(lead.id);
        }
        await logAgentAction({
          agent: "growth",
          action: "kofi.email_reply.escalated",
          metadata: {
            lead_id: lead?.id ?? null,
            from_email,
            dm_sent: res !== null,
            confidence: parsed.confidence,
          },
          status: "completed",
        });
      });
    }

    return {
      ok: true,
      classification: parsed.classification,
      lead_id: lead?.id ?? null,
    };
  },
);
