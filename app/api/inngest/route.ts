/**
 * Inngest serve endpoint — exposes all registered functions to the
 * Inngest dev server / cloud, accepts incoming step invocations,
 * and handles signing.
 */

import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { socialJob } from "@/inngest/functions/social-job";
import { growthJob } from "@/inngest/functions/growth-job";
import { cooJob } from "@/inngest/functions/coo-job";
import {
  approvalGrantedJob,
  approvalRejectedJob,
} from "@/inngest/functions/approval-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    socialJob,
    growthJob,
    cooJob,
    approvalGrantedJob,
    approvalRejectedJob,
  ],
});
