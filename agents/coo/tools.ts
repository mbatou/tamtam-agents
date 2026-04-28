/**
 * Tools available to the COO agent.
 *
 * The COO is read-mostly: it queries logs, posts the brief, and can
 * re-trigger stalled jobs by emitting Inngest events.
 */

import type { ToolDefinition } from "@/lib/anthropic";

export function cooTools(): ToolDefinition[] {
  return [
    {
      name: "fetch_recent_activity",
      description:
        "Fetch agent_logs and pending approvals for the Social and Growth " +
        "agents over the last N hours (default 24). Returns a JSON summary.",
      input_schema: {
        type: "object",
        properties: {
          hours: { type: "integer", minimum: 1, maximum: 168 },
        },
      },
      handler: async (_input) => {
        // TODO(session-2): query agent_logs + approvals via supabase
        throw new Error("fetch_recent_activity: not implemented (session 2)");
      },
    },
    {
      name: "retrigger_job",
      description:
        "Re-emit an Inngest event for a stalled agent (social or growth). " +
        "Use only when the COO detects a stuck job.",
      input_schema: {
        type: "object",
        properties: {
          agent: { type: "string", enum: ["social", "growth"] },
          reason: { type: "string" },
        },
        required: ["agent", "reason"],
      },
      handler: async (_input) => {
        // TODO(session-2): inngest.send({ name: "agents/<x>.run", ... })
        throw new Error("retrigger_job: not implemented (session 2)");
      },
    },
    {
      name: "post_daily_brief",
      description:
        "Post the structured daily brief to #tamtam-coo. Pass the fully " +
        "formatted brief text as `brief`.",
      input_schema: {
        type: "object",
        properties: {
          brief: { type: "string" },
          ping_georges: { type: "boolean" },
        },
        required: ["brief"],
      },
      handler: async (_input) => {
        // TODO(session-2): postAsAgent({ agent: "coo", channel: COO_CHANNEL, ... })
        throw new Error("post_daily_brief: not implemented (session 2)");
      },
    },
  ];
}
