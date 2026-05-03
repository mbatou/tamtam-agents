/**
 * Inngest function: Kofi's response monitor.
 *
 * Cron: every 2 hours. Polls inbound channels for replies that
 * arrived without a real-time webhook.
 *
 * LinkedIn: getLinkedInMessages() returns [] until partnership-tier
 *   API access exists. The polling loop is in place so the moment
 *   that access lands, the only edit is in lib/linkedin.ts.
 *
 * Email: replies arrive via /api/webhooks/email-reply (real-time)
 *   which emits tamtam/kofi.email-replied. They are classified by
 *   the kofiEmailReplied function below — the cron does not double
 *   that work, it only handles inbound channels that lack webhooks.
 */

import { inngest } from "@/lib/inngest";
import { getLinkedInMessages } from "@/lib/linkedin";
import { logAgentAction } from "@/lib/supabase";

export const kofiResponseMonitor = inngest.createFunction(
  { id: "kofi-response-monitor", name: "Kofi — response monitor" },
  [
    { cron: "0 */2 * * *" },
    { event: "tamtam/kofi.response-monitor" },
  ],
  async ({ step }) => {
    return step.run("poll-inbound", async () => {
      const linkedInMessages = await getLinkedInMessages();

      // When LinkedIn API access lands, classify and emit per-message
      // events. Today this loop runs over [] cleanly.
      for (const _msg of linkedInMessages) {
        // TODO(linkedin-real): emit a tamtam/kofi.linkedin-replied
        // event mirror of the email path, classify via Claude, and
        // escalate to Georges on positive intent.
      }

      await logAgentAction({
        agent: "growth",
        action: "kofi.response_monitor.tick",
        metadata: {
          linkedin_messages: linkedInMessages.length,
          note:
            linkedInMessages.length === 0
              ? "no linkedin api access yet"
              : "ok",
        },
        status: "completed",
      });

      return { linkedin_messages: linkedInMessages.length };
    });
  },
);
