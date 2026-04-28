/**
 * OpenAI client wrapper — DALL-E 3 image generation.
 *
 * The Social agent calls `generatePostImage` to render visuals for
 * LinkedIn posts. Bytes are returned in-memory; persistence to Supabase
 * Storage is the caller's responsibility (see lib/supabase.ts).
 */

import OpenAI from "openai";
import { env } from "./env";

let clientSingleton: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (clientSingleton) return clientSingleton;
  clientSingleton = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return clientSingleton;
}

export type ImageSize = "1024x1024" | "1024x1792" | "1792x1024";
export type ImageQuality = "standard" | "hd";
export type ImageStyle = "vivid" | "natural";

export interface GeneratePostImageInput {
  prompt: string;
  size?: ImageSize;
  quality?: ImageQuality;
  style?: ImageStyle;
}

export interface GeneratePostImageResult {
  prompt: string;
  /** Revised prompt as returned by DALL-E 3 (it rewrites prompts). */
  revisedPrompt: string | null;
  /** PNG bytes ready to upload to storage. */
  bytes: Buffer;
  contentType: "image/png";
}

export async function generatePostImage(
  input: GeneratePostImageInput,
): Promise<GeneratePostImageResult> {
  const client = getOpenAI();

  const res = await client.images.generate({
    model: env.OPENAI_IMAGE_MODEL,
    prompt: input.prompt,
    n: 1,
    size: input.size ?? "1024x1024",
    quality: input.quality ?? "hd",
    style: input.style ?? "vivid",
    response_format: "b64_json",
  });

  const first = res.data?.[0];
  if (!first?.b64_json) {
    throw new Error("[openai] generatePostImage returned no image data");
  }

  return {
    prompt: input.prompt,
    revisedPrompt: first.revised_prompt ?? null,
    bytes: Buffer.from(first.b64_json, "base64"),
    contentType: "image/png",
  };
}
