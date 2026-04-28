/**
 * Inngest function: handles the side effects of an approval decision.
 *
 * `tamtam/approval.granted`  — actually publish / send the approved artifact.
 * `tamtam/approval.rejected` — log; no further action (the interaction
 *                              handler already updated the Slack message).
 *
 * This is the only place that reaches into the LinkedIn API or Resend in
 * response to Georges' click. The interaction route is intentionally tiny.
 */

import { inngest } from "@/lib/inngest";
import { publishApprovedPost } from "@/agents/social/tools";
import { sendApprovedOutreach } from "@/agents/growth/tools";
import { logAgentAction } from "@/lib/supabase";

export const approvalGrantedJob = inngest.createFunction(
  { id: "approval-granted", name: "Approval granted side effects" },
  { event: "tamtam/approval.granted" },
  async ({ event, step }) => {
    const { approval_id, agent, type, payload } = event.data;

    return step.run("dispatch-approval", async () => {
      await logAgentAction({
        agent,
        action: "approval.dispatch.started",
        metadata: { approval_id, type },
        status: "started",
      });

      try {
        if (type === "linkedin_post" && payload.kind === "linkedin_post") {
          const result = await publishApprovedPost({
            approvalId: approval_id,
            postId: payload.post_id,
          });
          await logAgentAction({
            agent,
            action: "approval.dispatch.completed",
            metadata: { approval_id, type, result },
            status: "completed",
          });
          return result;
        }

        if (type === "outreach_email" && payload.kind === "outreach_email") {
          const result = await sendApprovedOutreach({
            approvalId: approval_id,
            leadId: payload.lead_id,
            to: payload.to,
            subject: payload.subject,
            bodyMarkdown: payload.body_markdown,
          });
          await logAgentAction({
            agent,
            action: "approval.dispatch.completed",
            metadata: { approval_id, type, result },
            status: "completed",
          });
          return result;
        }

        await logAgentAction({
          agent,
          action: "approval.dispatch.skipped",
          metadata: { approval_id, type, reason: "no_matching_handler" },
          status: "skipped",
        });
        return { skipped: true, reason: "no_matching_handler" };
      } catch (err) {
        await logAgentAction({
          agent,
          action: "approval.dispatch.failed",
          metadata: {
            approval_id,
            type,
            error: err instanceof Error ? err.message : String(err),
          },
          status: "failed",
        });
        throw err;
      }
    });
  },
);

export const approvalRejectedJob = inngest.createFunction(
  { id: "approval-rejected", name: "Approval rejected logging" },
  { event: "tamtam/approval.rejected" },
  async ({ event, step }) => {
    return step.run("log-rejection", async () => {
      await logAgentAction({
        agent: event.data.agent,
        action: "approval.rejected",
        metadata: {
          approval_id: event.data.approval_id,
          type: event.data.type,
        },
        status: "completed",
      });
      return { ok: true };
    });
  },
);
