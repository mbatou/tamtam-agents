/**
 * Slack Interactions endpoint — handles button clicks (Approve / Edit / Reject).
 *
 * Slack POSTs interactions as `application/x-www-form-urlencoded` with a
 * `payload` field containing JSON. We verify the signature against the raw
 * body, parse the payload, persist the decision in Supabase, and emit an
 * Inngest event so downstream side effects (publishing, sending) happen
 * asynchronously and idempotently.
 */

import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { isApprovalActionId, verifySlackSignature } from "@/lib/slack";
import type { ApprovalButtonValue, ApprovalDecision } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SlackBlockActionsPayload {
  type: "block_actions";
  user: { id: string };
  actions: Array<{
    action_id: string;
    value: string;
  }>;
  message?: { ts: string };
}

export async function POST(req: Request): Promise<Response> {
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

  // TODO(session-2):
  //   1. setApprovalDecision(value.approval_id, decision)
  //   2. inngest.send({ name: "approvals/decision",
  //                     data: { approval_id, decision } })
  //   3. update the original Slack message to reflect the decision
  return NextResponse.json({
    ok: true,
    approval_id: value.approval_id,
    decision,
  });
}
