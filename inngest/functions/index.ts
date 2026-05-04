/**
 * Inngest function barrel.
 *
 * Single source of truth for what's registered with Inngest.
 * /app/api/inngest/route.ts imports `INNGEST_FUNCTIONS` from here.
 *
 * Add a new function: write the file, import it here, append to the
 * array. The serve endpoint discovers it on next sync — no edits to
 * the route needed.
 */

import { socialJob } from "./social-job";
import { growthJob } from "./growth-job";
import { cooJob } from "./coo-job";
import {
  approvalGrantedJob,
  approvalRejectedJob,
} from "./approval-job";
import { teamStandup } from "./team-standup";
import {
  reactToPostPublished,
  reactToLeadResearched,
  reactToApprovalGranted,
  reactToApprovalRejected,
} from "./team-reactions";
import { randomMoments } from "./random-moments";
import { fridayWrapup } from "./friday-wrapup";
import { georgesCheckin } from "./georges-checkin";
import { teamTestReactions } from "./team-test-reactions";
import { statusRotation } from "./status-rotation";
import { memberOnboarding } from "./member-onboarding";
import { kofiDailyProspecting } from "./kofi-daily-prospecting";
import { kofiResponseMonitor } from "./kofi-response-monitor";
import { kofiEmailReplied } from "./kofi-email-replied";
import { kofiThreadReply } from "./kofi-thread-reply";

export const INNGEST_FUNCTIONS = [
  // Per-agent runners
  socialJob,
  growthJob,
  cooJob,

  // Approval side effects
  approvalGrantedJob,
  approvalRejectedJob,

  // Team-life
  teamStandup,
  reactToPostPublished,
  reactToLeadResearched,
  reactToApprovalGranted,
  reactToApprovalRejected,
  randomMoments,
  fridayWrapup,
  georgesCheckin,
  teamTestReactions,

  // Three-app identity (Session 4 transformation)
  statusRotation,
  memberOnboarding,

  // Kofi autonomous (Session 5B–5D)
  kofiDailyProspecting,
  kofiResponseMonitor,
  kofiEmailReplied,
  kofiThreadReply,
] as const;
