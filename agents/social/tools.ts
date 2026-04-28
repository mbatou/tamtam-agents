/**
 * Tools available to the Social agent.
 *
 * Tools are the only way the agent affects the outside world. Each tool
 * has a strict JSON schema and a typed handler. The handlers are exercised
 * by lib/anthropic.ts → runWithTools.
 */

import type { ToolDefinition } from "@/lib/anthropic";

export function socialTools(): ToolDefinition[] {
  return [
    {
      name: "generate_image",
      description:
        "Generate a visual for the post via DALL-E 3 and store it in " +
        "Supabase Storage. Returns a public URL the post will reference.",
      input_schema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "DALL-E 3 prompt. Be visual, concrete, and on-brand.",
          },
          size: {
            type: "string",
            enum: ["1024x1024", "1024x1792", "1792x1024"],
            description: "Image dimensions. Default 1024x1024.",
          },
        },
        required: ["prompt"],
      },
      handler: async (_input) => {
        // TODO(session-2):
        //   1. call generatePostImage({ prompt, size })
        //   2. uploadImageToStorage({ pathInBucket, bytes, contentType })
        //   3. return { url, revisedPrompt, path }
        throw new Error("generate_image: not implemented (session 2)");
      },
    },
    {
      name: "request_approval",
      description:
        "Send a preview of the post (caption + image) to Georges in Slack " +
        "and pause. Returns the approval id; the post will be published " +
        "only after Georges clicks Approve.",
      input_schema: {
        type: "object",
        properties: {
          caption: { type: "string" },
          image_url: { type: "string", description: "Public Supabase URL." },
        },
        required: ["caption", "image_url"],
      },
      handler: async (_input) => {
        // TODO(session-2):
        //   1. insert into posts (status: pending_approval)
        //   2. createApproval({ agent: "social", type: "linkedin_post", payload })
        //   3. postAsAgent({ agent: "social", channel: APPROVALS_CHANNEL,
        //                    blocks: buildApprovalBlocks(...) })
        //   4. attachSlackTsToApproval(approvalId, ts)
        throw new Error("request_approval: not implemented (session 2)");
      },
    },
    {
      name: "publish_post",
      description:
        "INTERNAL — invoked by the approval handler after Georges approves. " +
        "The agent itself must not call this tool directly.",
      input_schema: {
        type: "object",
        properties: { post_id: { type: "string" } },
        required: ["post_id"],
      },
      handler: async (_input) => {
        // TODO(session-2): publish to LinkedIn, update posts.status & post_id
        throw new Error("publish_post: not implemented (session 2)");
      },
    },
  ];
}
