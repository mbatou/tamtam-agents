/**
 * Inngest serve endpoint — exposes all registered functions to the
 * Inngest dev server / cloud, accepts incoming step invocations,
 * and handles signing.
 *
 * Functions are registered via the barrel at inngest/functions/index.ts
 * so adding a new one is one import there, no edit here.
 */

import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { INNGEST_FUNCTIONS } from "@/inngest/functions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [...INNGEST_FUNCTIONS],
});
