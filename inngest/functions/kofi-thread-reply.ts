/**
 * Inngest function: continue a Slack thread Kofi started.
 *
 * Triggered by tamtam/growth.thread-reply (emitted by
 * /api/slack/events when Georges posts a thread reply in
 * #tamtam-growth without an @-mention).
 *
 * Steps:
 *   1. fetch thread history via conversations.replies
 *   2. verify Kofi was actually in the thread — if not, drop
 *      so we never hijack threads someone else started
 *   3. ask Claude (with Kofi's persona prompt + the thread)
 *      whether to respond, and what to say. The prompt allows
 *      a special token "DONE" meaning "the conversation has
 *      wound down — don't post anything"
 *   4. if not DONE, post the reply IN THE THREAD (thread_ts
 *      preserved) with no typing pause — instant ack
 *
 * Idempotency:
 *   - Inngest event id = `growth-thread-reply-${slack_event_id}`
 *     set at send-time so retries collapse.
 *   - concurrency.key on event.data.thread_ts so two rapid
 *     replies in the same thread queue rather than overlap.
 */

import { inngest } from "@/lib/inngest";
import { generateText } from "@/lib/anthropic";
import {
  getBotIdentity,
  getThreadMessages,
  postAsAgent,
  type ThreadMessage,
} from "@/lib/slack";
import { logAgentAction } from "@/lib/supabase";
import { GROWTH_SYSTEM_PROMPT } from "@/agents/growth/system-prompt";

const DONE_MARKER = "DONE";

/** Compact a thread for Claude's context window. */
function formatThread(
  messages: ReadonlyArray<ThreadMessage>,
  kofiUserId: string,
  kofiBotId: string,
  georgesUserId: string | undefined,
): string {
  return messages
    .map((m) => {
      const isKofi = m.bot_id === kofiBotId || m.user === kofiUserId;
      const isGeorges =
        georgesUserId !== undefined && m.user === georgesUserId;
      const speaker = isKofi
        ? "Kofi (you)"
        : isGeorges
          ? "Georges"
          : `someone (user=${m.user ?? "?"})`;
      const text = (m.text ?? "").trim();
      return `[${speaker}] ${text}`;
    })
    .join("\n");
}

export const kofiThreadReply = inngest.createFunction(
  {
    id: "kofi-thread-reply",
    name: "Kofi — continue a thread",
    // Two rapid replies in the same thread queue, never overlap.
    concurrency: { limit: 1, key: "event.data.thread_ts" },
  },
  { event: "tamtam/growth.thread-reply" },
  async ({ event, step }) => {
    const { thread_ts, channel, user, text } = event.data;

    /* ── 1. Fetch thread history ─────────────────────────────────────── */
    const messages = await step.run("get-thread-history", async () =>
      getThreadMessages({
        agent: "growth",
        channel,
        thread_ts,
        limit: 50,
      }).catch(() => [] as ThreadMessage[]),
    );

    /* ── 2. Verify Kofi posted in this thread ────────────────────────── */
    interface Verdict {
      kofiInThread: boolean;
      reason: string | null;
      kofi_user_id: string | null;
      kofi_bot_id: string | null;
    }
    const verdict: Verdict = await step.run(
      "verify-kofi-in-thread",
      async () => {
        if (messages.length === 0) {
          return {
            kofiInThread: false,
            reason: "thread_history_empty",
            kofi_user_id: null,
            kofi_bot_id: null,
          };
        }
        try {
          const identity = await getBotIdentity("growth");
          const inThread = messages.some(
            (m) =>
              m.bot_id === identity.bot_id || m.user === identity.user_id,
          );
          return {
            kofiInThread: inThread,
            reason: inThread ? null : "kofi_not_in_thread",
            kofi_user_id: identity.user_id,
            kofi_bot_id: identity.bot_id,
          };
        } catch (err) {
          return {
            kofiInThread: false,
            reason: "auth_test_failed",
            kofi_user_id: null,
            kofi_bot_id: null,
            error: err instanceof Error ? err.message : String(err),
          } as Verdict;
        }
      },
    );

    if (
      !verdict.kofiInThread ||
      !verdict.kofi_user_id ||
      !verdict.kofi_bot_id
    ) {
      await logAgentAction({
        agent: "growth",
        action: "thread_reply.skipped",
        metadata: {
          thread_ts,
          channel,
          user,
          reason: verdict.reason ?? "unknown",
        },
        status: "skipped",
      }).catch(() => undefined);
      return { posted: false, reason: verdict.reason ?? "unknown" };
    }

    const kofiUserId: string = verdict.kofi_user_id;
    const kofiBotId: string = verdict.kofi_bot_id;

    /* ── 3. Decide-or-DONE via Claude ─────────────────────────────────── */
    const decision = await step.run("decide-to-respond", async () => {
      const threadText = formatThread(
        messages,
        kofiUserId,
        kofiBotId,
        process.env.SLACK_GEORGES_USER_ID,
      );

      const result = await generateText({
        system: GROWTH_SYSTEM_PROMPT,
        user:
          `You are in a conversation thread in #tamtam-growth.\n` +
          `Here is the full thread so far (oldest first):\n\n` +
          threadText +
          `\n\nGeorges just replied with:\n` +
          `> ${text}\n\n` +
          `Decide whether to respond, and if so what to say. ` +
          `Use these rules:\n` +
          `  - If Georges gave a clear answer to your question, ` +
          `acknowledge it naturally and close the loop.\n` +
          `  - If Georges asked something new, answer it directly.\n` +
          `  - If Georges is just closing out (e.g. "thanks", ` +
          `"ok", "got it"), reply with a brief warm ack ` +
          `("anytime", "👍", etc.) and stop.\n` +
          `  - If the conversation has clearly wound down and you ` +
          `genuinely have NOTHING useful to add (e.g. you already ` +
          `gave the closing ack and Georges acknowledged that), ` +
          `respond with EXACTLY "${DONE_MARKER}" and only that — ` +
          `nothing else, no quotes.\n` +
          `  - If Georges said something ambiguous, ask ONE ` +
          `clarifying question.\n\n` +
          `Reply in YOUR voice (Kofi). UNDER 40 words. No bullet ` +
          `lists. No "successfully" / "processed" / "updated". ` +
          `Sound like a teammate continuing a chat, not a system. ` +
          `Output the message text only, no preamble, no quotes ` +
          `around it.`,
        maxTokens: 200,
        temperature: 0.5,
      });

      return { text: result.text.trim(), tokens: result.outputTokens };
    });

    /* ── 4. Post (or skip on DONE) ────────────────────────────────────── */
    const reply = decision.text;
    if (reply.length === 0 || reply.toUpperCase().startsWith(DONE_MARKER)) {
      await logAgentAction({
        agent: "growth",
        action: "thread_reply.done",
        metadata: {
          thread_ts,
          channel,
          tokens: decision.tokens,
          raw_first_chars: reply.slice(0, 80),
        },
        status: "completed",
      }).catch(() => undefined);
      return { posted: false, reason: "done_marker" };
    }

    const post = await step.run("post-in-thread", async () =>
      postAsAgent({
        agent: "growth",
        channel,
        threadTs: thread_ts,
        text: reply,
      }),
    );

    await logAgentAction({
      agent: "growth",
      action: "thread_reply.posted",
      metadata: {
        thread_ts,
        channel,
        slack_ts: post.ts,
        length: reply.length,
        tokens: decision.tokens,
      },
      status: "completed",
    }).catch(() => undefined);

    return { posted: true, slack_ts: post.ts, length: reply.length };
  },
);
