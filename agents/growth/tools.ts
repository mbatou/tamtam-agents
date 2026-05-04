/**
 * Tools available to the Growth agent.
 */

import type { ToolDefinition } from "@/lib/anthropic";
import { generateText } from "@/lib/anthropic";
import {
  attachSlackTsToApproval,
  createApproval,
  getLead,
  getPipelineSnapshot,
  logAgentAction,
  setLeadStatus,
  updateLeadStatusByCompany,
  upsertLead,
} from "@/lib/supabase";
import {
  buildApprovalBlocks,
  defaultChannelFor,
  postAsAgent,
  updateAgentMessage,
} from "@/lib/slack";
import { sendOutreachEmail } from "@/lib/resend";
import { inngest } from "@/lib/inngest";
import { speakAs } from "@/lib/team-voice";
import OutreachEmail from "@/emails/outreach-template";
import { createElement } from "react";
import type {
  ApprovalPayloadOutreachEmail,
  Lead,
} from "@/types";
import { env } from "@/lib/env";

export interface SlackContext {
  channel: string;
  user: string;
  thread_ts?: string;
}

interface ToolCtx {
  slack?: SlackContext;
}

function approvalChannelFor(ctx: ToolCtx): {
  channel: string;
  threadTs?: string;
} {
  if (ctx.slack) {
    return { channel: ctx.slack.channel, threadTs: ctx.slack.thread_ts };
  }
  return { channel: defaultChannelFor("growth") };
}

/* -------------------------------------------------------------------------- */
/*  Tool input shapes                                                         */
/* -------------------------------------------------------------------------- */

interface ResearchLeadInput {
  company: string;
  contact_name?: string;
  email?: string;
  notes?: string;
}

interface DraftEmailInput {
  lead_id: string;
  context?: string;
}

interface SendApprovalRequestInput {
  lead_id: string;
  subject: string;
  body_markdown: string;
  to: string;
}

interface LogActivityInput {
  action: string;
  metadata?: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/*  Factory                                                                   */
/* -------------------------------------------------------------------------- */

export function growthTools(ctx: ToolCtx = {}): ToolDefinition[] {
  return [
    {
      name: "research_lead",
      description:
        "Create or update a lead in Supabase based on a brief research " +
        "summary the agent has gathered. Use Claude to flesh out the " +
        "company profile in the `notes` field. Returns the lead id.",
      input_schema: {
        type: "object",
        properties: {
          company: { type: "string" },
          contact_name: { type: "string" },
          email: { type: "string" },
          notes: { type: "string" },
        },
        required: ["company"],
      },
      handler: async (input) => {
        const i = input as ResearchLeadInput;
        await logAgentAction({
          agent: "growth",
          action: "tool.research_lead.started",
          metadata: { company: i.company },
          status: "started",
        });
        try {
          let notes = i.notes;
          if (!notes || notes.trim().length === 0) {
            // Ask Claude for a short structured profile when the agent
            // didn't supply notes itself.
            const profile = await generateText({
              system:
                "You are a sales researcher for Tamtam. Produce a 4–6 line " +
                "factual profile of the company. No marketing fluff. If " +
                "you do not know a fact, write 'unknown'.",
              user: `Company: ${i.company}\n${i.contact_name ? `Contact: ${i.contact_name}` : ""}`,
              maxTokens: 400,
              temperature: 0.3,
            });
            notes = profile.text;
          }

          const lead = await upsertLead({
            company: i.company,
            contact_name: i.contact_name ?? null,
            email: i.email ?? null,
            status: i.email ? "queued" : "researching",
            last_contact_at: null,
            notes,
          });

          await logAgentAction({
            agent: "growth",
            action: "tool.research_lead.completed",
            metadata: {
              lead_id: lead.id,
              company: lead.company,
              status: lead.status,
            },
            status: "completed",
          });

          // Fan out to the team: triggers Awa reacting in #tamtam-team
          // (asks Kofi about the brand). Best-effort.
          await inngest
            .send({
              name: "tamtam/lead.researched",
              data: {
                lead_id: lead.id,
                company: lead.company,
                notes: notes ?? null,
              },
            })
            .catch(() => undefined);

          return { lead_id: lead.id, status: lead.status, notes };
        } catch (err) {
          await logAgentAction({
            agent: "growth",
            action: "tool.research_lead.failed",
            metadata: {
              company: i.company,
              error: err instanceof Error ? err.message : String(err),
            },
            status: "failed",
          });
          throw err;
        }
      },
    },

    {
      name: "draft_email",
      description:
        "Draft an outreach email for the given lead. Returns subject + " +
        "body_markdown. Does NOT send.",
      input_schema: {
        type: "object",
        properties: {
          lead_id: { type: "string" },
          context: {
            type: "string",
            description: "Optional extra context to weave into the draft.",
          },
        },
        required: ["lead_id"],
      },
      handler: async (input) => {
        const i = input as DraftEmailInput;
        await logAgentAction({
          agent: "growth",
          action: "tool.draft_email.started",
          metadata: { lead_id: i.lead_id },
          status: "started",
        });
        try {
          const lead = await getLead(i.lead_id);
          if (!lead.email) {
            throw new Error(
              `Cannot draft email — lead ${lead.id} (${lead.company}) has no email yet.`,
            );
          }

          const draft = await generateText({
            system:
              "You write outreach emails for Tamtam, a WhatsApp Status " +
              "micro-influencer marketing platform from Dakar. Follow these " +
              "rules:\n" +
              "- Subject ≤ 7 words, lowercase, no clickbait.\n" +
              "- Open with one specific observation about the company.\n" +
              "- One sentence on what Tamtam does, plain English.\n" +
              "- One concrete ask.\n" +
              "- Sign off as Georges Mbatou, Founder, Tamtam.\n" +
              "Output JSON: {\"subject\": string, \"body_markdown\": string}.",
            user:
              `Lead:\nCompany: ${lead.company}\nContact: ${lead.contact_name ?? "unknown"}\n` +
              `Email: ${lead.email}\nNotes: ${lead.notes ?? "(none)"}\n` +
              `${i.context ? `\nExtra context:\n${i.context}` : ""}`,
            maxTokens: 800,
            temperature: 0.5,
          });

          // Parse JSON robustly — Claude sometimes wraps in markdown fences.
          const cleaned = draft.text
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();
          let parsed: { subject: string; body_markdown: string };
          try {
            parsed = JSON.parse(cleaned) as {
              subject: string;
              body_markdown: string;
            };
          } catch {
            throw new Error(
              `Could not parse email draft as JSON. Raw output:\n${draft.text}`,
            );
          }

          await logAgentAction({
            agent: "growth",
            action: "tool.draft_email.completed",
            metadata: {
              lead_id: lead.id,
              subject: parsed.subject,
              body_length: parsed.body_markdown.length,
            },
            status: "completed",
          });

          return {
            lead_id: lead.id,
            to: lead.email,
            subject: parsed.subject,
            body_markdown: parsed.body_markdown,
          };
        } catch (err) {
          await logAgentAction({
            agent: "growth",
            action: "tool.draft_email.failed",
            metadata: {
              lead_id: i.lead_id,
              error: err instanceof Error ? err.message : String(err),
            },
            status: "failed",
          });
          throw err;
        }
      },
    },

    {
      name: "send_approval_request",
      description:
        "Persist an approval record and post a Slack approval block to " +
        "Georges with subject + email body preview. The agent must STOP " +
        "after calling this tool — the email will be sent only after " +
        "Georges clicks Approve.",
      input_schema: {
        type: "object",
        properties: {
          lead_id: { type: "string" },
          subject: { type: "string" },
          body_markdown: { type: "string" },
          to: { type: "string" },
        },
        required: ["lead_id", "subject", "body_markdown", "to"],
      },
      handler: async (input) => {
        const i = input as SendApprovalRequestInput;
        await logAgentAction({
          agent: "growth",
          action: "tool.send_approval_request.started",
          metadata: { lead_id: i.lead_id, subject: i.subject },
          status: "started",
        });
        try {
          const approval = await createApproval({
            agent: "growth",
            type: "outreach_email",
            payload: {
              kind: "outreach_email",
              lead_id: i.lead_id,
              to: i.to,
              subject: i.subject,
              body_markdown: i.body_markdown,
            } satisfies ApprovalPayloadOutreachEmail,
          });

          const target = approvalChannelFor(ctx);
          const preview =
            `*To:* ${i.to}\n*Subject:* ${i.subject}\n\n` +
            "```\n" +
            (i.body_markdown.length > 800
              ? i.body_markdown.slice(0, 800) + "…"
              : i.body_markdown) +
            "\n```";

          const slackRes = await postAsAgent({
            agent: "growth",
            channel: target.channel,
            threadTs: target.threadTs,
            text: "New outreach email awaiting approval.",
            blocks: buildApprovalBlocks({
              approvalId: approval.id,
              headline: "📈 Tamtam Growth — Email Approval",
              preview,
            }),
          });
          await attachSlackTsToApproval(approval.id, slackRes.ts);

          await logAgentAction({
            agent: "growth",
            action: "tool.send_approval_request.completed",
            metadata: {
              approval_id: approval.id,
              lead_id: i.lead_id,
              slack_ts: slackRes.ts,
            },
            status: "completed",
          });
          return { approval_id: approval.id, slack_ts: slackRes.ts };
        } catch (err) {
          await logAgentAction({
            agent: "growth",
            action: "tool.send_approval_request.failed",
            metadata: {
              lead_id: i.lead_id,
              error: err instanceof Error ? err.message : String(err),
            },
            status: "failed",
          });
          throw err;
        }
      },
    },

    {
      name: "update_lead_status_by_company",
      description:
        "Find a lead by partial company name (case-insensitive) and " +
        "update its status. Use this when Georges tells you in Slack " +
        "things like 'Wave Sénégal replied, they're interested' " +
        "(status='warm', classification='positive') or 'mark Jumia " +
        "as dead' (status='rejected'). Append a short note explaining " +
        "the change so the audit trail stays useful.",
      input_schema: {
        type: "object",
        properties: {
          company_query: {
            type: "string",
            description:
              "A partial company name. Case-insensitive ILIKE match.",
          },
          status: {
            type: "string",
            enum: [
              "researched",
              "contacted",
              "warm",
              "hot",
              "paused",
              "rejected",
              "converted",
              "cold",
            ],
          },
          classification: {
            type: "string",
            enum: ["positive", "neutral", "negative", "referral"],
            description:
              "Optional. Set when the status change reflects a known " +
              "response sentiment.",
          },
          note: {
            type: "string",
            description:
              "One-line audit note appended to the lead's notes column.",
          },
        },
        required: ["company_query", "status"],
      },
      handler: async (input) => {
        const i = input as {
          company_query: string;
          status: Lead["status"];
          classification?:
            | "positive"
            | "neutral"
            | "negative"
            | "referral";
          note?: string;
        };
        const updated = await updateLeadStatusByCompany({
          companyQuery: i.company_query,
          status: i.status,
          classification: i.classification,
          noteAppend: i.note,
        });
        if (!updated) {
          // No match: still ack so Georges isn't left wondering.
          await speakAs({
            agent: "growth",
            channel: defaultChannelFor("growth"),
            instant: true,
            source: "tool.ack.update_lead_status.no_match",
            maxTokens: 100,
            brief:
              `Georges asked you to update a lead by partial name ` +
              `but no match was found in the CRM:\n` +
              `  Query: "${i.company_query}"\n` +
              `  Wanted status: ${i.status}\n\n` +
              `Acknowledge in YOUR voice. Under 25 words. Ask for ` +
              `the exact company name or another identifier. Don't ` +
              `say "no match" or "not found" — sound like a teammate ` +
              `who looked, didn't see it, and wants the right name. ` +
              `Skip greetings, skip "I" at the start, skip " ` +
              `"successfully" / "processed" / "updated".`,
          }).catch(() => undefined);
          return {
            ok: false,
            reason: "no_match",
            company_query: i.company_query,
          };
        }
        await logAgentAction({
          agent: "growth",
          action: "tool.update_lead_status_by_company.completed",
          metadata: {
            lead_id: updated.id,
            company: updated.company,
            new_status: i.status,
            classification: i.classification ?? null,
          },
          status: "completed",
        });

        // Immediate, contextual ack in #tamtam-growth.
        await speakAs({
          agent: "growth",
          channel: defaultChannelFor("growth"),
          instant: true,
          source: `tool.ack.update_lead_status.${i.status}`,
          maxTokens: 130,
          brief:
            `You just updated a lead's status. Acknowledge in ` +
            `#tamtam-growth in YOUR voice. ONE sentence ack + ` +
            `ONE sentence with your strategic read on what this ` +
            `means. Under 30 words total. Don't say "successfully" ` +
            `/ "processed" / "updated" / "database". Sound like a ` +
            `teammate, not a system notification.\n\n` +
            `Lead just updated:\n` +
            `  Company: ${updated.company}\n` +
            `  Contact: ${updated.contact_name ?? "unknown"}\n` +
            `  Title: ${updated.contact_title ?? "unknown"}\n` +
            `  New status: ${i.status}\n` +
            (i.classification
              ? `  Classification: ${i.classification}\n`
              : "") +
            `  Intent signal: ${updated.intent_signal ?? "none"}\n` +
            `  Why now (research): ${updated.why_now ?? "none"}\n` +
            `  Confidence score: ${updated.confidence_score ?? "—"}\n` +
            `  Awa-warmed: ${updated.awa_warmup ? "yes" : "no"}\n\n` +
            `Status reaction guidance:\n` +
            `  rejected → archived; brief reason if you can read it ` +
            `from notes; quickly move on.\n` +
            `  warm → you'll prioritise on the next follow-up cycle.\n` +
            `  hot → 🔥 Georges should know; suggest his attention.\n` +
            `  converted → ✅ celebrate briefly; flag Rama.\n` +
            `  paused → won't touch them until told otherwise.\n` +
            `  contacted → fine, back into the cadence.\n` +
            `  cold → archived this round; can revisit next quarter.\n\n` +
            `If you have a specific take based on the lead's profile ` +
            `(industry, signal, contact title) that genuinely fits — ` +
            `add it. Don't pad with filler.`,
        }).catch(() => undefined);

        return {
          ok: true,
          lead_id: updated.id,
          company: updated.company,
          status: updated.status,
        };
      },
    },

    {
      name: "add_manual_lead",
      description:
        "Add a lead Georges supplied directly (e.g. 'add Amadou " +
        "Diallo, marketing@dakarfood.sn, Dakar Food'). Status starts " +
        "at 'researched' so the next prospecting run picks it up. " +
        "Use only when Georges has explicitly given you contact " +
        "details — never invent them.",
      input_schema: {
        type: "object",
        properties: {
          company: { type: "string" },
          contact_name: { type: "string" },
          email: { type: "string" },
          contact_title: { type: "string" },
          notes: { type: "string" },
        },
        required: ["company"],
      },
      handler: async (input) => {
        const i = input as {
          company: string;
          contact_name?: string;
          email?: string;
          contact_title?: string;
          notes?: string;
        };
        const lead = await upsertLead({
          company: i.company,
          contact_name: i.contact_name ?? null,
          contact_title: i.contact_title ?? null,
          email: i.email ?? null,
          status: "researched",
          notes:
            (i.notes ? i.notes + "\n" : "") +
            `Source: manual_georges (${new Date().toISOString()})`,
          // A Georges-supplied contact is verified by definition.
          intent_signal: "manual_georges_referral",
          confidence_score: 90,
          awa_warmup: false,
          outreach_channel: i.email ? "email" : null,
          why_now: "Georges supplied directly",
        });
        await logAgentAction({
          agent: "growth",
          action: "tool.add_manual_lead.completed",
          metadata: { lead_id: lead.id, company: lead.company },
          status: "completed",
        });

        await speakAs({
          agent: "growth",
          channel: defaultChannelFor("growth"),
          instant: true,
          source: "tool.ack.add_manual_lead",
          maxTokens: 130,
          brief:
            `Georges just supplied a new lead by hand. Acknowledge ` +
            `in #tamtam-growth in YOUR voice. ONE sentence ack ` +
            `naming the contact + company. ONE sentence about ` +
            `timing — typically you'll include them in tomorrow ` +
            `morning's prospecting run (08:00 WAT). If something ` +
            `about the brand sparks a thought (industry, recent ` +
            `Awa coverage, ICP fit), add it briefly. Under 35 ` +
            `words. Don't say "added to the database" / ` +
            `"successfully" / "processed".\n\n` +
            `New lead just created:\n` +
            `  Company: ${lead.company}\n` +
            `  Contact: ${lead.contact_name ?? "(not provided)"}\n` +
            `  Title: ${lead.contact_title ?? "(not provided)"}\n` +
            `  Email: ${lead.email ?? "(no email yet)"}\n` +
            `  Source: manual_georges`,
        }).catch(() => undefined);

        return { ok: true, lead_id: lead.id, company: lead.company };
      },
    },

    {
      name: "pause_lead",
      description:
        "Pause outreach to a lead. Status becomes 'paused' and the " +
        "follow-up cadence skips them until Georges says otherwise.",
      input_schema: {
        type: "object",
        properties: {
          company_query: { type: "string" },
          reason: { type: "string" },
        },
        required: ["company_query"],
      },
      handler: async (input) => {
        const i = input as { company_query: string; reason?: string };
        const updated = await updateLeadStatusByCompany({
          companyQuery: i.company_query,
          status: "paused",
          noteAppend: `Paused${i.reason ? ` — ${i.reason}` : ""}`,
        });
        if (!updated) {
          await speakAs({
            agent: "growth",
            channel: defaultChannelFor("growth"),
            instant: true,
            source: "tool.ack.pause_lead.no_match",
            maxTokens: 80,
            brief:
              `Georges asked you to pause a lead but no CRM match ` +
              `was found:\n  Query: "${i.company_query}"\n` +
              `  Reason: ${i.reason ?? "(none given)"}\n\n` +
              `Acknowledge in YOUR voice. Under 25 words. Ask for ` +
              `the exact name. Don't say "no match found" / ` +
              `"successfully".`,
          }).catch(() => undefined);
          return { ok: false, reason: "no_match" };
        }

        await speakAs({
          agent: "growth",
          channel: defaultChannelFor("growth"),
          instant: true,
          source: "tool.ack.pause_lead",
          maxTokens: 100,
          brief:
            `You just paused outreach to ${updated.company}. ` +
            `Acknowledge in YOUR voice. ONE short sentence. Under ` +
            `20 words. Confirm you won't contact them until told ` +
            `otherwise. If a reason was given (${
              i.reason ?? "(none)"
            }), reference it briefly. Don't say "successfully" / ` +
            `"processed".`,
        }).catch(() => undefined);

        return { ok: true, company: updated.company };
      },
    },

    {
      name: "get_pipeline_summary",
      description:
        "Return a snapshot of the lead pipeline grouped by status, " +
        "plus the monthly Apollo credit counter, AND post the " +
        "pipeline snapshot to #tamtam-growth as Kofi. Use this to " +
        "answer 'what's the pipeline?' / 'where are we?' questions.",
      input_schema: { type: "object", properties: {} },
      handler: async () => {
        const snap = await getPipelineSnapshot();
        const summary = {
          hot: snap.hot.map((l) => l.company),
          warm: snap.warm.map((l) => l.company),
          contacted: snap.contacted.map((l) => l.company),
          paused: snap.paused.map((l) => l.company),
          cold_count: snap.cold.length,
          converted: snap.converted.map((l) => l.company),
          apollo: {
            used: snap.apollo_credits_used,
            remaining: snap.apollo_credits_remaining,
          },
        };

        // Post the snapshot directly in Kofi's voice — Georges
        // gets the answer immediately, not just data the agent
        // loop has to format.
        await speakAs({
          agent: "growth",
          channel: defaultChannelFor("growth"),
          instant: true,
          source: "tool.ack.pipeline_summary",
          maxTokens: 400,
          brief:
            `Georges asked for the pipeline snapshot. Post it in ` +
            `#tamtam-growth in YOUR voice. Use this exact format ` +
            `for the body, then close with ONE observation or ONE ` +
            `question. Don't say "summary" / "report" / ` +
            `"generated":\n\n` +
            `Format:\n` +
            `  Here's where we stand Georges:\n\n` +
            `  🔥 Hot (${summary.hot.length}): ${summary.hot.join(", ") || "—"}\n` +
            `  🌡️ Warm (${summary.warm.length}): ${summary.warm.join(", ") || "—"}\n` +
            `  📧 Contacted (${summary.contacted.length}): ${
              summary.contacted.slice(0, 6).join(", ") || "—"
            }${summary.contacted.length > 6 ? ` (+${summary.contacted.length - 6} more)` : ""}\n` +
            `  ⏸️ Paused (${summary.paused.length}): ${summary.paused.join(", ") || "—"}\n` +
            `  ✅ Converted (${summary.converted.length}): ${summary.converted.join(", ") || "—"}\n` +
            `  ❄️ Cold (${summary.cold_count}): archived\n` +
            `  Apollo: ${summary.apollo.used}/${summary.apollo.used + summary.apollo.remaining} credits used this month\n\n` +
            `Then close with: a) one observation about the ` +
            `pipeline shape (light? heavy? warm-skewed?) OR b) ` +
            `one question for Georges (specific brand to target? ` +
            `industry to push?). Pick whichever fits — don't do ` +
            `both. Under 30 words on the close.`,
        }).catch(() => undefined);

        return summary;
      },
    },

    {
      name: "log_activity",
      description:
        "Record a free-form activity entry in agent_logs.",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string" },
          metadata: { type: "object" },
        },
        required: ["action"],
      },
      handler: async (input) => {
        const i = input as LogActivityInput;
        await logAgentAction({
          agent: "growth",
          action: i.action,
          metadata: i.metadata ?? {},
          status: "completed",
        });
        return { ok: true };
      },
    },
  ];
}

/* -------------------------------------------------------------------------- */
/*  Approval-side-effect helper                                               */
/* -------------------------------------------------------------------------- */

export interface SendApprovedOutreachInput {
  approvalId: string;
  leadId: string;
  to: string;
  subject: string;
  bodyMarkdown: string;
}

export interface SendApprovedOutreachResult {
  message_id: string;
  to: string;
  status: Lead["status"];
}

export async function sendApprovedOutreach(
  input: SendApprovedOutreachInput,
): Promise<SendApprovedOutreachResult> {
  await logAgentAction({
    agent: "growth",
    action: "outreach.send.started",
    metadata: {
      approval_id: input.approvalId,
      lead_id: input.leadId,
      to: input.to,
    },
    status: "started",
  });

  try {
    const lead = await getLead(input.leadId);
    if (lead.status === "contacted") {
      // Idempotent: already sent for this lead in this campaign window.
      await logAgentAction({
        agent: "growth",
        action: "outreach.send.skipped",
        metadata: { lead_id: lead.id, reason: "already_contacted" },
        status: "skipped",
      });
      return { message_id: "skipped", to: input.to, status: lead.status };
    }

    const firstName = lead.contact_name?.split(/\s+/)[0] ?? null;
    const plainText = stripMarkdown(input.bodyMarkdown);
    const sent = await sendOutreachEmail({
      to: input.to,
      subject: input.subject,
      template: createElement(OutreachEmail, {
        recipientFirstName: firstName,
        bodyMarkdown: input.bodyMarkdown,
        signatureName: "Georges Mbatou",
        signatureTitle: "Founder",
        signatureCompany: "Tamtam",
        preview: input.subject,
      }),
      text: plainText,
      replyTo: env.RESEND_FROM_EMAIL,
    });

    const updated = await setLeadStatus(lead.id, "contacted", {
      lastContactAt: new Date().toISOString(),
    });

    await logAgentAction({
      agent: "growth",
      action: "outreach.send.completed",
      metadata: {
        approval_id: input.approvalId,
        lead_id: lead.id,
        to: input.to,
        message_id: sent.id,
      },
      status: "completed",
    });

    // Confirmation in the Growth channel — replaces the original approval msg.
    const approval = await import("@/lib/supabase").then((m) =>
      m.getApproval(input.approvalId),
    );
    if (approval.slack_message_ts) {
      await updateAgentMessage({
        agent: "growth",
        channel: defaultChannelFor("growth"),
        ts: approval.slack_message_ts,
        text: `:envelope_with_arrow: Sent to ${input.to}.`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:envelope_with_arrow: *Sent to* \`${input.to}\` (lead: *${lead.company}*).`,
            },
          },
        ],
      }).catch(() => undefined);
    }

    return { message_id: sent.id, to: input.to, status: updated.status };
  } catch (err) {
    await logAgentAction({
      agent: "growth",
      action: "outreach.send.failed",
      metadata: {
        approval_id: input.approvalId,
        lead_id: input.leadId,
        error: err instanceof Error ? err.message : String(err),
      },
      status: "failed",
    });
    throw err;
  }
}

/**
 * Naive markdown stripper for the plain-text email body. Good enough for
 * personal outreach; we're not running a CMS.
 */
function stripMarkdown(input: string): string {
  return input
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}
