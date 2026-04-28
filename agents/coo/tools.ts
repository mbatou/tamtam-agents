/**
 * Tools available to the COO agent.
 *
 * The COO is read-mostly: it queries logs and approvals, posts the brief,
 * and can re-trigger stalled jobs by emitting Inngest events. It never
 * generates customer-facing content directly.
 */

import type { ToolDefinition } from "@/lib/anthropic";
import {
  getPendingApprovals,
  getRecentAgentLogs,
  logAgentAction,
} from "@/lib/supabase";
import {
  defaultChannelFor,
  openDmChannelFor,
  postAsAgent,
} from "@/lib/slack";
import { env } from "@/lib/env";
import { inngest } from "@/lib/inngest";
import type { AgentName } from "@/types";

interface ToolCtx {
  // No slack context required for COO — the brief always goes to #tamtam-coo.
}

/* -------------------------------------------------------------------------- */
/*  Tool input shapes                                                         */
/* -------------------------------------------------------------------------- */

interface GetAgentLogsInput {
  agent: AgentName;
  hours?: number;
}

interface PostDailyBriefInput {
  brief: string;
  ping_georges?: boolean;
}

interface DmGeorgesInput {
  message: string;
}

interface RetriggerJobInput {
  agent: "social" | "growth";
  reason: string;
}

interface LogActivityInput {
  action: string;
  metadata?: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/*  Factory                                                                   */
/* -------------------------------------------------------------------------- */

export function cooTools(_ctx: ToolCtx = {}): ToolDefinition[] {
  return [
    {
      name: "get_agent_logs",
      description:
        "Read agent_logs for the specified agent over the last N hours " +
        "(default 8). Returns rows ordered newest first.",
      input_schema: {
        type: "object",
        properties: {
          agent: { type: "string", enum: ["social", "growth", "coo"] },
          hours: { type: "integer", minimum: 1, maximum: 168 },
        },
        required: ["agent"],
      },
      handler: async (input) => {
        const i = input as GetAgentLogsInput;
        const hours = i.hours ?? 8;
        const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
        const rows = await getRecentAgentLogs(i.agent, since);
        return {
          agent: i.agent,
          hours,
          since,
          count: rows.length,
          rows: rows.map((r) => ({
            id: r.id,
            action: r.action,
            status: r.status,
            metadata: r.metadata,
            created_at: r.created_at,
          })),
        };
      },
    },

    {
      name: "get_pending_approvals",
      description:
        "Return all approvals where decision = 'pending', newest first.",
      input_schema: {
        type: "object",
        properties: {},
      },
      handler: async () => {
        const rows = await getPendingApprovals();
        return {
          count: rows.length,
          rows: rows.map((r) => ({
            id: r.id,
            agent: r.agent,
            type: r.type,
            slack_message_ts: r.slack_message_ts,
            created_at: r.created_at,
          })),
        };
      },
    },

    {
      name: "post_daily_brief",
      description:
        "Post the structured daily brief to the COO channel. Pass the " +
        "fully-formatted brief text as `brief`. Set `ping_georges` to " +
        "true ONLY when a decision is needed.",
      input_schema: {
        type: "object",
        properties: {
          brief: { type: "string" },
          ping_georges: { type: "boolean" },
        },
        required: ["brief"],
      },
      handler: async (input) => {
        const i = input as PostDailyBriefInput;
        await logAgentAction({
          agent: "coo",
          action: "tool.post_daily_brief.started",
          metadata: { length: i.brief.length, ping: !!i.ping_georges },
          status: "started",
        });
        try {
          const text = i.ping_georges
            ? `<!channel> Decision needed.\n${i.brief}`
            : i.brief;
          const res = await postAsAgent({
            agent: "coo",
            channel: defaultChannelFor("coo"),
            text,
          });
          await logAgentAction({
            agent: "coo",
            action: "tool.post_daily_brief.completed",
            metadata: { slack_ts: res.ts, ping: !!i.ping_georges },
            status: "completed",
          });
          return { slack_ts: res.ts };
        } catch (err) {
          await logAgentAction({
            agent: "coo",
            action: "tool.post_daily_brief.failed",
            metadata: { error: err instanceof Error ? err.message : String(err) },
            status: "failed",
          });
          throw err;
        }
      },
    },

    {
      name: "dm_georges",
      description:
        "Escalate a message to Georges. When SLACK_GEORGES_USER_ID is set, " +
        "delivers a real DM via conversations.open + chat.postMessage. " +
        "Otherwise falls back to an @channel post in #tamtam-coo. " +
        "Use sparingly — only when a real human decision is needed.",
      input_schema: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
      handler: async (input) => {
        const i = input as DmGeorgesInput;
        const georgesId = env.SLACK_GEORGES_USER_ID;
        const mode: "dm" | "channel_mention" = georgesId ? "dm" : "channel_mention";

        await logAgentAction({
          agent: "coo",
          action: "tool.dm_georges.invoked",
          metadata: { length: i.message.length, mode },
          status: "started",
        });
        try {
          let channel: string;
          let text: string;
          if (georgesId) {
            channel = await openDmChannelFor(georgesId);
            text = i.message;
          } else {
            channel = defaultChannelFor("coo");
            text = `<!channel> ${i.message}`;
          }

          const res = await postAsAgent({
            agent: "coo",
            channel,
            text,
          });
          await logAgentAction({
            agent: "coo",
            action: "tool.dm_georges.completed",
            metadata: { slack_ts: res.ts, mode },
            status: "completed",
          });
          return { slack_ts: res.ts, mode };
        } catch (err) {
          await logAgentAction({
            agent: "coo",
            action: "tool.dm_georges.failed",
            metadata: {
              mode,
              error: err instanceof Error ? err.message : String(err),
            },
            status: "failed",
          });
          throw err;
        }
      },
    },

    {
      name: "retrigger_job",
      description:
        "Re-emit the .run event for a stalled agent. Use only when the COO " +
        "detects a stuck job (e.g., a 'started' log with no matching " +
        "'completed' or 'failed' for over an hour).",
      input_schema: {
        type: "object",
        properties: {
          agent: { type: "string", enum: ["social", "growth"] },
          reason: { type: "string" },
        },
        required: ["agent", "reason"],
      },
      handler: async (input) => {
        const i = input as RetriggerJobInput;
        await logAgentAction({
          agent: "coo",
          action: "tool.retrigger_job.invoked",
          metadata: { agent: i.agent, reason: i.reason },
          status: "started",
        });
        try {
          const eventName =
            i.agent === "social" ? "tamtam/social.run" : "tamtam/growth.run";
          const ids = await inngest.send({
            name: eventName,
            data: { trigger: "cron" },
          });
          await logAgentAction({
            agent: "coo",
            action: "tool.retrigger_job.completed",
            metadata: { agent: i.agent, event_ids: ids.ids },
            status: "completed",
          });
          return { ok: true, agent: i.agent, event_ids: ids.ids };
        } catch (err) {
          await logAgentAction({
            agent: "coo",
            action: "tool.retrigger_job.failed",
            metadata: {
              agent: i.agent,
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
      description: "Record a free-form activity entry in agent_logs.",
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
          agent: "coo",
          action: i.action,
          metadata: i.metadata ?? {},
          status: "completed",
        });
        return { ok: true };
      },
    },
  ];
}
