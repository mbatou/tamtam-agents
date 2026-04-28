/**
 * Tools available to the Social agent.
 *
 * Tools are the only way the agent affects the outside world. Each tool
 * has a strict JSON schema and a typed handler that:
 *   1. Logs `<tool>.started` to agent_logs
 *   2. Performs its side effect
 *   3. Logs `<tool>.completed` (or `<tool>.failed`) to agent_logs
 *
 * The factory captures a per-run `SlackContext` so that approvals raised
 * from inside a Slack thread are sent back to the same thread.
 */

import type { ToolDefinition } from "@/lib/anthropic";
import { generateText } from "@/lib/anthropic";
// import { generatePostImage } from "@/lib/openai";  // see TODO on generate_image below
import {
  attachSlackTsToApproval,
  createApproval,
  createPost,
  getApproval,
  getPost,
  logAgentAction,
  updatePostStatus,
  // uploadImageToStorage,  // see TODO on generate_image below
} from "@/lib/supabase";
import {
  buildApprovalBlocks,
  defaultChannelFor,
  postAsAgent,
  updateAgentMessage,
} from "@/lib/slack";
import type {
  ApprovalPayloadLinkedinPost,
  Post,
} from "@/types";

export interface SlackContext {
  channel: string;
  user: string;
  thread_ts?: string;
}

interface ToolCtx {
  slack?: SlackContext;
}

function approvalChannelFor(ctx: ToolCtx): {
  channel: string;
  threadTs?: string;
} {
  if (ctx.slack) {
    return { channel: ctx.slack.channel, threadTs: ctx.slack.thread_ts };
  }
  return { channel: defaultChannelFor("social") };
}

/* -------------------------------------------------------------------------- */
/*  Tool input schemas (typed at the boundary)                                */
/* -------------------------------------------------------------------------- */

interface GenerateCaptionInput {
  topic: string;
  tone?: string;
  platform?: "linkedin";
}

interface GenerateImageInput {
  prompt: string;
  size?: "1024x1024" | "1024x1792" | "1792x1024";
}

interface SendApprovalRequestInput {
  caption: string;
  image_url: string;
  image_prompt: string;
  scheduled_at?: string;
}

interface GetPostAnalyticsInput {
  post_id: string;
}

interface LogActivityInput {
  action: string;
  metadata?: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/*  Tool factory                                                              */
/* -------------------------------------------------------------------------- */

export function socialTools(ctx: ToolCtx = {}): ToolDefinition[] {
  return [
    {
      name: "generate_caption",
      description:
        "Generate a LinkedIn caption with the Tamtam Social voice. " +
        "Returns the caption text. Does not post anything.",
      input_schema: {
        type: "object",
        properties: {
          topic: { type: "string" },
          tone: {
            type: "string",
            description:
              "Optional tone hint (e.g. 'sharp', 'warm', 'urgent').",
          },
          platform: { type: "string", enum: ["linkedin"] },
        },
        required: ["topic"],
      },
      handler: async (input) => {
        const i = input as GenerateCaptionInput;
        await logAgentAction({
          agent: "social",
          action: "tool.generate_caption.started",
          metadata: { topic: i.topic, tone: i.tone ?? null },
          status: "started",
        });
        try {
          const tone = i.tone ?? "sharp, founder-voiced, West-African specific";
          const result = await generateText({
            system:
              "You write LinkedIn captions for Tamtam in the voice " +
              "described in the system prompt. Output ONLY the caption " +
              "text — no preamble, no quotes.",
            user:
              `Topic: ${i.topic}\nTone: ${tone}\nLength: 150–220 words.\n` +
              `End with one clear CTA. Maximum two emojis.`,
            maxTokens: 600,
            temperature: 0.7,
          });
          await logAgentAction({
            agent: "social",
            action: "tool.generate_caption.completed",
            metadata: { tokens: result.outputTokens, length: result.text.length },
            status: "completed",
          });
          return { caption: result.text };
        } catch (err) {
          await logAgentAction({
            agent: "social",
            action: "tool.generate_caption.failed",
            metadata: { error: err instanceof Error ? err.message : String(err) },
            status: "failed",
          });
          throw err;
        }
      },
    },

    {
      name: "generate_image",
      description:
        "Generate a visual for the post. Returns a public URL the post " +
        "can reference. Currently STUBBED with a placeholder image while " +
        "OpenAI billing is being activated; the agent should still call " +
        "this tool — it just gets back a placeholder URL.",
      input_schema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          size: {
            type: "string",
            enum: ["1024x1024", "1024x1792", "1792x1024"],
          },
        },
        required: ["prompt"],
      },
      // TODO: restore DALL-E once OpenAI billing is active.
      // Real implementation: call generatePostImage(prompt) from
      // lib/openai.ts, then uploadImageToStorage() from lib/supabase.ts,
      // and return { url, path, revised_prompt } as before.
      handler: async (input) => {
        const i = input as GenerateImageInput;
        console.log("[social/tools] generate_image stubbed — prompt:", i.prompt);

        await logAgentAction({
          agent: "social",
          action: "tool.generate_image.stubbed",
          metadata: {
            prompt: i.prompt,
            size: i.size ?? "1024x1024",
            reason: "openai_billing_inactive",
          },
          status: "completed",
        });

        // Reliable, Slack-renderable placeholder. Replace once DALL-E
        // is back online.
        return {
          url: "https://placehold.co/1200x630/1a1a2e/ffffff?text=Tamtam+Post",
          path: "placeholder",
          revised_prompt: null,
          stubbed: true,
        };
      },
    },

    {
      name: "send_approval_request",
      description:
        "Persist a draft LinkedIn post, create an approval record, and " +
        "post a Slack approval message to Georges with Approve/Edit/Reject " +
        "buttons. The agent must STOP after calling this tool — the post " +
        "will be published only after Georges clicks Approve.",
      input_schema: {
        type: "object",
        properties: {
          caption: { type: "string" },
          image_url: { type: "string" },
          image_prompt: { type: "string" },
          scheduled_at: {
            type: "string",
            description: "ISO-8601 timestamp; omit for 'as soon as approved'.",
          },
        },
        required: ["caption", "image_url", "image_prompt"],
      },
      handler: async (input) => {
        const i = input as SendApprovalRequestInput;
        await logAgentAction({
          agent: "social",
          action: "tool.send_approval_request.started",
          metadata: { caption_length: i.caption.length },
          status: "started",
        });
        try {
          const post = await createPost({
            platform: "linkedin",
            caption: i.caption,
            image_url: i.image_url,
            image_prompt: i.image_prompt,
            scheduled_at: i.scheduled_at ?? null,
            status: "pending_approval",
            post_id: null,
          });

          const approval = await createApproval({
            agent: "social",
            type: "linkedin_post",
            payload: {
              kind: "linkedin_post",
              post_id: post.id,
              caption: i.caption,
              image_url: i.image_url,
            } satisfies ApprovalPayloadLinkedinPost,
          });

          const target = approvalChannelFor(ctx);
          const slackRes = await postAsAgent({
            agent: "social",
            channel: target.channel,
            threadTs: target.threadTs,
            text: "New LinkedIn post awaiting approval.",
            blocks: buildApprovalBlocks({
              approvalId: approval.id,
              headline: "🎨 Tamtam Social — Post Approval",
              preview: i.caption,
              imageUrl: i.image_url,
            }),
          });
          await attachSlackTsToApproval(approval.id, slackRes.ts);

          await logAgentAction({
            agent: "social",
            action: "tool.send_approval_request.completed",
            metadata: {
              approval_id: approval.id,
              post_id: post.id,
              slack_ts: slackRes.ts,
            },
            status: "completed",
          });
          return {
            approval_id: approval.id,
            post_id: post.id,
            slack_ts: slackRes.ts,
          };
        } catch (err) {
          await logAgentAction({
            agent: "social",
            action: "tool.send_approval_request.failed",
            metadata: { error: err instanceof Error ? err.message : String(err) },
            status: "failed",
          });
          throw err;
        }
      },
    },

    {
      name: "get_post_analytics",
      description:
        "Fetch analytics for a previously published post. " +
        "Returns mock data until the LinkedIn analytics integration is wired.",
      input_schema: {
        type: "object",
        properties: { post_id: { type: "string" } },
        required: ["post_id"],
      },
      handler: async (input) => {
        const i = input as GetPostAnalyticsInput;
        await logAgentAction({
          agent: "social",
          action: "tool.get_post_analytics.invoked",
          metadata: { post_id: i.post_id, mock: true },
          status: "completed",
        });
        return {
          post_id: i.post_id,
          impressions: 0,
          clicks: 0,
          reactions: 0,
          comments: 0,
          mock: true,
          note: "LinkedIn analytics not yet wired — placeholder values.",
        };
      },
    },

    {
      name: "log_activity",
      description:
        "Record a free-form activity entry in agent_logs. Use this to " +
        "annotate non-tool reasoning that should still be auditable.",
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
          agent: "social",
          action: i.action,
          metadata: i.metadata ?? {},
          status: "completed",
        });
        return { ok: true };
      },
    },
  ];
}

/* -------------------------------------------------------------------------- */
/*  Approval-side-effect helper (called by approval-job, not by Claude)       */
/* -------------------------------------------------------------------------- */

export interface PublishApprovedPostInput {
  approvalId: string;
  postId: string;
}

export interface PublishApprovedPostResult {
  post_id: string;
  external_post_id: string;
  status: Post["status"];
  mocked: true;
}

/**
 * Mocked LinkedIn publish path. Wires up the full data flow (read post,
 * "publish", update status, post Slack confirmation) but stops short of
 * calling the real LinkedIn API. When that integration lands, the only
 * thing that changes here is the externalPostId source.
 */
export async function publishApprovedPost(
  input: PublishApprovedPostInput,
): Promise<PublishApprovedPostResult> {
  await logAgentAction({
    agent: "social",
    action: "publish.started",
    metadata: { approval_id: input.approvalId, post_id: input.postId },
    status: "started",
  });

  try {
    const post = await getPost(input.postId);
    if (post.status === "published") {
      // Idempotent: already done.
      return {
        post_id: post.id,
        external_post_id: post.post_id ?? "unknown",
        status: post.status,
        mocked: true,
      };
    }

    // TODO(linkedin-integration): replace with a real LinkedIn UGC POST.
    const mockExternalId = `mock-li-${Date.now()}`;
    const updated = await updatePostStatus({
      postId: post.id,
      status: "published",
      externalPostId: mockExternalId,
    });

    // Best-effort Slack confirmation in the agent's default channel.
    const approval = await getApproval(input.approvalId);
    const channel = defaultChannelFor("social");
    if (approval.slack_message_ts) {
      await updateAgentMessage({
        agent: "social",
        channel,
        ts: approval.slack_message_ts,
        text: `:rocket: Published to LinkedIn (mock id ${mockExternalId}).`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:rocket: *Published to LinkedIn* (mock id \`${mockExternalId}\`).\n>${updated.caption.split("\n")[0]}`,
            },
          },
        ],
      }).catch(() => undefined);
    }

    await logAgentAction({
      agent: "social",
      action: "publish.completed",
      metadata: {
        approval_id: input.approvalId,
        post_id: post.id,
        external_post_id: mockExternalId,
        mocked: true,
      },
      status: "completed",
    });

    return {
      post_id: updated.id,
      external_post_id: mockExternalId,
      status: updated.status,
      mocked: true,
    };
  } catch (err) {
    await logAgentAction({
      agent: "social",
      action: "publish.failed",
      metadata: {
        approval_id: input.approvalId,
        post_id: input.postId,
        error: err instanceof Error ? err.message : String(err),
      },
      status: "failed",
    });
    // Mark the post as failed so the COO can detect the blocker.
    await updatePostStatus({
      postId: input.postId,
      status: "failed",
    }).catch(() => undefined);
    throw err;
  }
}
