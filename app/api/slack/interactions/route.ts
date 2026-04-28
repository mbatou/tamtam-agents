/**
 * Slack Interactions endpoint — handles button clicks (Approve / Edit / Reject).
 *
 * Slack POSTs interactions as `application/x-www-form-urlencoded` with a
 * `payload` field containing JSON. We:
 *   1. Verify the signature against the raw body.
 *   2. Parse the payload.
 *   3. Persist the decision in Supabase (transactional source of truth).
 *   4. Emit an Inngest event for the side effect (publish, send, etc.).
 *   5. Update the original Slack message so the buttons disappear and
 *      Georges sees what was decided.
 *   6. ACK 200 immediately.
 */

import { NextResponse } from "next/server";
import { env, MissingEnvError, validateEnv } from "@/lib/env";
import {
  defaultChannelFor,
  isApprovalActionId,
  postAsAgent,
  updateAgentMessage,
  verifySlackSignature,
} from "@/lib/slack";
import {
  getApproval,
  logAgentAction,
  setApprovalDecision,
} from "@/lib/supabase";
import { inngest } from "@/lib/inngest";
import type {
  ApprovalButtonValue,
  ApprovalDecision,
  ApprovalPayload,
} from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SlackBlockActionsPayload {
  type: "block_actions";
  user: { id: string; name?: string };
  actions: Array<{
    action_id: string;
    value: string;
  }>;
  message?: { ts: string };
  channel?: { id: string };
  response_url?: string;
}

export async function POST(req: Request): Promise<Response> {
  try {
    validateEnv();
  } catch (err) {
    if (err instanceof MissingEnvError) {
      return NextResponse.json(
        { ok: false, error: "missing_env", missing: err.missing },
        { status: 500 },
      );
    }
    throw err;
  }

  const rawBody = await req.text();
  const ok = verifySlackSignature({
    signingSecret: env.SLACK_SIGNING_SECRET,
    rawBody,
    timestamp: req.headers.get("x-slack-request-timestamp"),
    signature: req.headers.get("x-slack-signature"),
  });
  if (!ok) {
    return new NextResponse("invalid signature", { status: 401 });
  }

  const params = new URLSearchParams(rawBody);
  const payloadRaw = params.get("payload");
  if (!payloadRaw) {
    return new NextResponse("missing payload", { status: 400 });
  }

  let payload: SlackBlockActionsPayload;
  try {
    payload = JSON.parse(payloadRaw) as SlackBlockActionsPayload;
  } catch {
    return new NextResponse("invalid payload json", { status: 400 });
  }

  if (payload.type !== "block_actions") {
    return NextResponse.json({ ok: true, ignored: payload.type });
  }

  const action = payload.actions[0];
  if (!action || !isApprovalActionId(action.action_id)) {
    return NextResponse.json({ ok: true, ignored: "non-approval-action" });
  }

  let value: ApprovalButtonValue;
  try {
    value = JSON.parse(action.value) as ApprovalButtonValue;
  } catch {
    return new NextResponse("invalid action value", { status: 400 });
  }

  const decision: Exclude<ApprovalDecision, "pending"> =
    value.action === "approve"
      ? "approved"
      : value.action === "edit"
        ? "edited"
        : "rejected";

  // Persist first, then react. If persistence fails we never publish.
  const approval = await getApproval(value.approval_id);
  if (approval.decision !== "pending") {
    // Idempotent: clicking twice does nothing.
    return NextResponse.json({
      ok: true,
      already: approval.decision,
      approval_id: approval.id,
    });
  }

  await setApprovalDecision(value.approval_id, decision);
  await logAgentAction({
    agent: approval.agent,
    action: `approval.${decision}`,
    metadata: { approval_id: approval.id, by_user: payload.user.id },
    status: "completed",
  });

  // Emit the matching Inngest event.
  if (decision === "approved") {
    await inngest.send({
      name: "tamtam/approval.granted",
      data: {
        approval_id: approval.id,
        agent: approval.agent,
        type: approval.type,
        payload: approval.payload as ApprovalPayload,
      },
    });
  } else if (decision === "rejected") {
    await inngest.send({
      name: "tamtam/approval.rejected",
      data: {
        approval_id: approval.id,
        agent: approval.agent,
        type: approval.type,
      },
    });
  } else {
    await inngest.send({
      name: "tamtam/approval.edited",
      data: {
        approval_id: approval.id,
        agent: approval.agent,
        type: approval.type,
      },
    });
  }

  // Update the original message so the buttons go away.
  const channel = payload.channel?.id ?? defaultChannelFor(approval.agent);
  const ts = payload.message?.ts ?? approval.slack_message_ts;
  if (ts) {
    const decisionText =
      decision === "approved"
        ? `:white_check_mark: Approved by <@${payload.user.id}>`
        : decision === "rejected"
          ? `:x: Rejected by <@${payload.user.id}>`
          : `:pencil2: Edit requested by <@${payload.user.id}> — please reply in thread with the revised version.`;

    await updateAgentMessage({
      agent: approval.agent,
      channel,
      ts,
      text: decisionText,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: decisionText },
        },
      ],
    }).catch(() => undefined);
  }

  // For `edit`, post a thread reply prompting Georges to type the revision.
  if (decision === "edited" && ts) {
    await postAsAgent({
      agent: approval.agent,
      channel,
      threadTs: ts,
      text: "Please reply here with the revised version. I'll re-submit it for approval.",
    }).catch(() => undefined);
  }

  return NextResponse.json({
    ok: true,
    approval_id: value.approval_id,
    decision,
  });
}
