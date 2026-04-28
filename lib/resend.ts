/**
 * Resend email client.
 *
 * The Growth agent uses `sendOutreachEmail` once Georges has approved a
 * draft. Renders React Email templates to HTML at call time.
 */

import { Resend } from "resend";
import { render } from "@react-email/components";
import type { ReactElement } from "react";
import { env } from "./env";

let clientSingleton: Resend | null = null;

export function getResend(): Resend {
  if (clientSingleton) return clientSingleton;
  clientSingleton = new Resend(env.RESEND_API_KEY);
  return clientSingleton;
}

export interface SendOutreachEmailInput {
  to: string;
  subject: string;
  /** A React Email component already constructed by the caller. */
  template: ReactElement;
  /** Plain-text fallback. Strongly recommended for deliverability. */
  text: string;
  replyTo?: string;
}

export interface SendOutreachEmailResult {
  id: string;
  to: string;
  subject: string;
}

export async function sendOutreachEmail(
  input: SendOutreachEmailInput,
): Promise<SendOutreachEmailResult> {
  const html = await render(input.template);

  const res = await getResend().emails.send({
    from: env.RESEND_FROM_EMAIL,
    to: input.to,
    subject: input.subject,
    html,
    text: input.text,
    replyTo: input.replyTo,
  });

  if (res.error || !res.data) {
    throw new Error(
      `[resend] sendOutreachEmail failed: ${res.error?.message ?? "unknown error"}`,
    );
  }

  return { id: res.data.id, to: input.to, subject: input.subject };
}
