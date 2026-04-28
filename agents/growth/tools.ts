/**
 * Tools available to the Growth agent.
 */

import type { ToolDefinition } from "@/lib/anthropic";

export function growthTools(): ToolDefinition[] {
  return [
    {
      name: "upsert_lead",
      description:
        "Create or update a lead row in Supabase. Returns the lead id.",
      input_schema: {
        type: "object",
        properties: {
          company: { type: "string" },
          contact_name: { type: "string" },
          email: { type: "string" },
          notes: { type: "string" },
          status: {
            type: "string",
            enum: [
              "new",
              "researching",
              "queued",
              "contacted",
              "replied",
              "won",
              "lost",
              "do_not_contact",
            ],
          },
        },
        required: ["company"],
      },
      handler: async (_input) => {
        // TODO(session-2): upsert into leads table
        throw new Error("upsert_lead: not implemented (session 2)");
      },
    },
    {
      name: "draft_outreach",
      description:
        "Compose the email body and subject for a given lead and present " +
        "it for approval. Does NOT send the email.",
      input_schema: {
        type: "object",
        properties: {
          lead_id: { type: "string" },
          subject: { type: "string" },
          body_markdown: { type: "string" },
        },
        required: ["lead_id", "subject", "body_markdown"],
      },
      handler: async (_input) => {
        // TODO(session-2):
        //   1. createApproval({ agent: "growth", type: "outreach_email", payload })
        //   2. postAsAgent({ agent: "growth", channel: APPROVALS_CHANNEL, ... })
        throw new Error("draft_outreach: not implemented (session 2)");
      },
    },
    {
      name: "send_outreach",
      description:
        "INTERNAL — invoked by the approval handler after Georges approves. " +
        "The agent itself must not call this tool directly.",
      input_schema: {
        type: "object",
        properties: { approval_id: { type: "string" } },
        required: ["approval_id"],
      },
      handler: async (_input) => {
        // TODO(session-2): render React Email + sendOutreachEmail + log
        throw new Error("send_outreach: not implemented (session 2)");
      },
    },
  ];
}
