/**
 * Tools available to the Growth agent.
 */

import type { ToolDefinition } from "@/lib/anthropic";
import { generateText } from "@/lib/anthropic";
import {
  attachSlackTsToApproval,
  createApproval,
  getLead,
  logAgentAction,
  setLeadStatus,
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
