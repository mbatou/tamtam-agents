/**
 * Shared types for Tamtam Agents.
 *
 * These mirror the Supabase schema and the cross-cutting domain
 * objects that flow between agents, Inngest jobs, Slack handlers,
 * and the approval gate.
 */

/* -------------------------------------------------------------------------- */
/*  Agents                                                                    */
/* -------------------------------------------------------------------------- */

export type AgentName = "social" | "growth" | "coo";

export type AgentStatus = "ok" | "pending" | "error" | "blocked" | "idle";

export interface AgentPersona {
  /** Internal identifier used across the codebase. */
  name: AgentName;
  /** Human first name the agent goes by inside the team. */
  firstName: string;
  /** Display name shown in Slack via chat.write.customize. */
  username: string;
  /** Slack icon_emoji shown in Slack via chat.write.customize. */
  iconEmoji: string;
}

/* -------------------------------------------------------------------------- */
/*  Supabase: agent_logs                                                      */
/* -------------------------------------------------------------------------- */

export type AgentLogStatus = "started" | "completed" | "failed" | "skipped";

export interface AgentLog {
  id: string;
  agent: AgentName;
  action: string;
  metadata: Record<string, unknown>;
  status: AgentLogStatus;
  created_at: string;
}

export type AgentLogInsert = Omit<AgentLog, "id" | "created_at"> & {
  created_at?: string;
};

/* -------------------------------------------------------------------------- */
/*  Supabase: posts                                                           */
/* -------------------------------------------------------------------------- */

export type PostPlatform = "linkedin";

export type PostStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "scheduled"
  | "published"
  | "failed";

export interface Post {
  id: string;
  platform: PostPlatform;
  caption: string;
  image_url: string | null;
  image_prompt: string | null;
  scheduled_at: string | null;
  status: PostStatus;
  /** External platform id (e.g. LinkedIn URN) once published. */
  post_id: string | null;
  created_at: string;
}

export type PostInsert = Omit<Post, "id" | "created_at"> & {
  created_at?: string;
};

/* -------------------------------------------------------------------------- */
/*  Supabase: leads                                                           */
/* -------------------------------------------------------------------------- */

export type LeadStatus =
  | "new"
  | "researching"
  | "queued"
  | "contacted"
  | "replied"
  | "won"
  | "lost"
  | "do_not_contact";

export interface Lead {
  id: string;
  company: string;
  contact_name: string | null;
  email: string | null;
  status: LeadStatus;
  last_contact_at: string | null;
  notes: string | null;
  created_at: string;
}

export type LeadInsert = Omit<Lead, "id" | "created_at"> & {
  created_at?: string;
};

/* -------------------------------------------------------------------------- */
/*  Supabase: approvals                                                       */
/* -------------------------------------------------------------------------- */

export type ApprovalType =
  | "linkedin_post"
  | "outreach_email"
  | "lead_addition"
  | "other";

export type ApprovalDecision =
  | "pending"
  | "approved"
  | "rejected"
  | "edited"
  | "expired";

export interface ApprovalPayloadLinkedinPost {
  kind: "linkedin_post";
  post_id: string;
  caption: string;
  image_url: string | null;
  /**
   * The prompt used to generate the image. Surfaced in the approval
   * Slack message when the URL is a stub/external host (Slack only
   * renders inline images that live on https://files.slack.com).
   */
  image_prompt: string | null;
}

export interface ApprovalPayloadOutreachEmail {
  kind: "outreach_email";
  lead_id: string;
  to: string;
  subject: string;
  body_markdown: string;
}

export type ApprovalPayload =
  | ApprovalPayloadLinkedinPost
  | ApprovalPayloadOutreachEmail
  | { kind: "other"; [k: string]: unknown };

export interface Approval {
  id: string;
  agent: AgentName;
  type: ApprovalType;
  payload: ApprovalPayload;
  slack_message_ts: string | null;
  decision: ApprovalDecision;
  created_at: string;
}

export type ApprovalInsert = Omit<Approval, "id" | "created_at"> & {
  created_at?: string;
};

/* -------------------------------------------------------------------------- */
/*  Supabase Database type — re-exported from /types/database.ts              */
/* -------------------------------------------------------------------------- */

export type { Database, Json } from "./database";

/* -------------------------------------------------------------------------- */
/*  Slack interaction shapes (subset we actually consume)                     */
/* -------------------------------------------------------------------------- */

export type ApprovalAction = "approve" | "edit" | "reject";

export interface ApprovalButtonValue {
  approval_id: string;
  action: ApprovalAction;
}

/* -------------------------------------------------------------------------- */
/*  Inngest event payloads                                                    */
/*                                                                            */
/*  Naming convention: tamtam/<surface>.<verb>                                */
/*    - tamtam/<agent>.mentioned   — a Slack @-mention triggered the agent   */
/*    - tamtam/<agent>.run         — manual or scheduled run                  */
/*    - tamtam/coo.tick            — COO cron + manual tick                   */
/*    - tamtam/approval.granted    — Georges approved (post / send)           */
/*    - tamtam/approval.rejected   — Georges rejected                         */
/*    - tamtam/approval.edited     — Georges asked for an edit                */
/* -------------------------------------------------------------------------- */

export interface SocialMentionedEvent {
  name: "tamtam/social.mentioned";
  data: {
    text: string;
    channel: string;
    user: string;
    thread_ts?: string;
    event_ts: string;
  };
}

export interface GrowthMentionedEvent {
  name: "tamtam/growth.mentioned";
  data: {
    text: string;
    channel: string;
    user: string;
    thread_ts?: string;
    event_ts: string;
  };
}

export interface CooMentionedEvent {
  name: "tamtam/coo.mentioned";
  data: {
    text: string;
    channel: string;
    user: string;
    thread_ts?: string;
    event_ts: string;
  };
}

export interface SocialRunEvent {
  name: "tamtam/social.run";
  data: {
    trigger: "manual" | "cron" | "approval";
    brief?: string;
  };
}

export interface GrowthRunEvent {
  name: "tamtam/growth.run";
  data: {
    trigger: "manual" | "cron" | "approval";
    lead_id?: string;
  };
}

export interface CooTickEvent {
  name: "tamtam/coo.tick";
  data: {
    trigger: "cron" | "manual";
  };
}

export interface ApprovalGrantedEvent {
  name: "tamtam/approval.granted";
  data: {
    approval_id: string;
    agent: AgentName;
    type: ApprovalType;
    payload: ApprovalPayload;
  };
}

export interface ApprovalRejectedEvent {
  name: "tamtam/approval.rejected";
  data: {
    approval_id: string;
    agent: AgentName;
    type: ApprovalType;
  };
}

export interface ApprovalEditedEvent {
  name: "tamtam/approval.edited";
  data: {
    approval_id: string;
    agent: AgentName;
    type: ApprovalType;
  };
}

/* -------------------------------------------------------------------------- */
/*  Team-life events (Session 4)                                              */
/* -------------------------------------------------------------------------- */

export interface PostPublishedEvent {
  name: "tamtam/post.published";
  data: {
    post_id: string;
    external_post_id: string;
    caption: string;
  };
}

export interface LeadResearchedEvent {
  name: "tamtam/lead.researched";
  data: {
    lead_id: string;
    company: string;
    notes: string | null;
  };
}

export interface GeorgesCheckinEvent {
  name: "tamtam/georges.checkin";
  data: {
    text: string;
    channel: string;
    user: string;
    event_ts: string;
    thread_ts?: string;
  };
}

export interface TeamStandupCronEvent {
  name: "tamtam/team.standup";
  data: { trigger: "cron" | "manual" };
}

export interface TeamFridayWrapupCronEvent {
  name: "tamtam/team.friday-wrapup";
  data: { trigger: "cron" | "manual" };
}

export interface TeamRandomMomentCronEvent {
  name: "tamtam/team.random-moment";
  data: {
    trigger: "cron" | "manual";
    /** Slot id so we can correlate cron firings with the chosen moment. */
    slot: "morning" | "midday" | "afternoon" | "manual";
  };
}

export interface TeamTestReactionsEvent {
  name: "tamtam/team.test-reactions";
  data: { trigger: "cron" | "manual" };
}

export type AppInngestEvent =
  | SocialMentionedEvent
  | GrowthMentionedEvent
  | CooMentionedEvent
  | SocialRunEvent
  | GrowthRunEvent
  | CooTickEvent
  | ApprovalGrantedEvent
  | ApprovalRejectedEvent
  | ApprovalEditedEvent
  | PostPublishedEvent
  | LeadResearchedEvent
  | GeorgesCheckinEvent
  | TeamStandupCronEvent
  | TeamFridayWrapupCronEvent
  | TeamRandomMomentCronEvent
  | TeamTestReactionsEvent;
