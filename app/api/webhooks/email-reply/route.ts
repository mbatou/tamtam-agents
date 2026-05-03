/**
 * Inbound email-reply webhook.
 *
 * IMPORTANT — service-side reality:
 *   Resend tracks outbound delivery only (sent / delivered / opened
 *   / clicked / bounced). Replies land in the From-address mailbox,
 *   not back to Resend. To deliver replies here you need ONE of:
 *     - Resend Inbound (beta — requires MX records on a subdomain)
 *     - SendGrid Inbound Parse (forwards reply emails as POSTs)
 *     - A Postmark / Mailgun inbound route
 *     - Custom IMAP polling that posts to this URL
 *
 *   This endpoint accepts the lowest-common-denominator shape:
 *     { from, subject, text, signature?, in_reply_to_lead_id? }
 *   Verification is HMAC-SHA256 of the raw body using
 *   RESEND_WEBHOOK_SECRET (or whichever inbound product you wire
 *   — same secret slot, same HMAC).
 *
 * Pipeline:
 *   1. verify shared-secret signature
 *   2. parse payload
 *   3. ACK 200 immediately
 *   4. fire-and-forget emit tamtam/kofi.email-replied with the
 *      Inngest event id `email-reply-${signature_or_subject_hash}`
 *      so retries collapse.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env, MissingEnvError, validateEnv } from "@/lib/env";
import { inngest } from "@/lib/inngest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface InboundEmailPayload {
  from: string;
  subject: string;
  text: string;
  /** Some providers send a stable message id we can use to dedupe. */
  message_id?: string;
  /** Some providers include the original lead context. */
  in_reply_to_lead_id?: string;
}

/**
 * Verify HMAC-SHA256 of raw body. Header name is the
 * X-Webhook-Signature convention used across most inbound services.
 * Adjust if the chosen product uses a different header name.
 */
function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const computed =
    "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(computed);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function dedupeId(payload: InboundEmailPayload): string {
  if (payload.message_id) return `email-reply-${payload.message_id}`;
  // Fallback: hash subject+from. Collisions are vanishingly rare in
  // a real reply stream (subjects are unique enough per sender per day).
  const basis = `${payload.from}|${payload.subject}`;
  const h = createHmac("sha256", "tamtam-email-reply-dedupe")
    .update(basis)
    .digest("hex")
    .slice(0, 16);
  return `email-reply-${h}`;
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

  const secret = env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    // Strict by default — without a configured shared secret we
    // cannot trust the payload, so reject everything.
    return new NextResponse("webhook secret not configured", { status: 401 });
  }

  const rawBody = await req.text();
  const ok = verifySignature(
    rawBody,
    req.headers.get("x-webhook-signature"),
    secret,
  );
  if (!ok) {
    return new NextResponse("invalid signature", { status: 401 });
  }

  let payload: InboundEmailPayload;
  try {
    payload = JSON.parse(rawBody) as InboundEmailPayload;
  } catch {
    return new NextResponse("invalid json", { status: 400 });
  }

  if (!payload.from || !payload.subject || !payload.text) {
    return new NextResponse("missing required fields", { status: 400 });
  }

  // ACK first, then fire-and-forget.
  const response = NextResponse.json({ ok: true });

  (async () => {
    await inngest.send({
      id: dedupeId(payload),
      name: "tamtam/kofi.email-replied",
      data: {
        lead_id: payload.in_reply_to_lead_id ?? null,
        from_email: payload.from,
        subject: payload.subject,
        text: payload.text,
        received_at: new Date().toISOString(),
      },
    });
  })().catch((err: unknown) => {
    console.error("[webhooks/email-reply] dispatch error:", err);
  });

  return response;
}
