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
  | "researched"
  | "queued"
  | "contacted"
  | "warm"
  | "hot"
  | "replied"
  | "cold"
  | "rejected"
  | "paused"
  | "converted"
  | "won"
  | "lost"
  | "do_not_contact";

/* -------------------------------------------------------------------------- */
/*  Supabase: email_messages (Session 5C)                                     */
/* -------------------------------------------------------------------------- */

export type EmailDirection = "outbound";

export type EmailType = "day1" | "day4" | "day9" | "manual";

export interface EmailMessage {
  id: string;
  lead_id: string | null;
  direction: EmailDirection;
  subject: string;
  body: string;
  resend_message_id: string | null;
  email_type: EmailType;
  sent_at: string;
}

export interface EmailMessageInsert {
  id?: string;
  lead_id?: string | null;
  direction: EmailDirection;
  subject: string;
  body: string;
  resend_message_id?: string | null;
  email_type: EmailType;
  sent_at?: string;
}

export type LeadOutreachChannel = "linkedin" | "email" | "both";

export type LeadResponseClassification =
  | "positive"
  | "neutral"
  | "negative"
  | "referral";

export interface Lead {
  id: string;
  company: string;
  contact_name: string | null;
  contact_title: string | null;
  email: string | null;
  status: LeadStatus;
  last_contact_at: string | null;
  notes: string | null;
  created_at: string;
  /* ─── Session 5B — Kofi autonomous columns ──────────────────────── */
  intent_signal: string | null;
  confidence_score: number | null;
  awa_warmup: boolean;
  outreach_channel: LeadOutreachChannel | null;
  why_now: string | null;
  linkedin_url: string | null;
  linkedin_message_id: string | null;
  day4_sent_at: string | null;
  day9_sent_at: string | null;
  response_classification: LeadResponseClassification | null;
  escalated_to_georges: boolean;
  escalated_at: string | null;
}

/**
 * `LeadInsert` mirrors the database column nullability + defaults:
 * required = `company`. Everything else is optional and matches the
 * default value the column gets in Postgres (NULL or `false`).
 */
export interface LeadInsert {
  company: string;
  contact_name?: string | null;
  contact_title?: string | null;
  email?: string | null;
  status?: LeadStatus;
  last_contact_at?: string | null;
  notes?: string | null;
  created_at?: string;
  intent_signal?: string | null;
  confidence_score?: number | null;
  awa_warmup?: boolean;
  outreach_channel?: LeadOutreachChannel | null;
  why_now?: string | null;
  linkedin_url?: string | null;
  linkedin_message_id?: string | null;
  day4_sent_at?: string | null;
  day9_sent_at?: string | null;
  response_classification?: LeadResponseClassification | null;
  escalated_to_georges?: boolean;
  escalated_at?: string | null;
}

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
/*  Supabase: agent_settings (Session 6 — dashboard)                          */
/* -------------------------------------------------------------------------- */

export interface AgentSettings {
  id: string;
  agent: AgentName;
  focus_this_week: string | null;
  tone: string;
  post_frequency: string;
  daily_lead_target: number;
  apollo_monthly_budget: number;
  icp_focus: string;
  outreach_day4: number;
  outreach_day9: number;
  standup_time: string;
  brief_frequency: string;
  babacar_reminder: boolean;
  is_active: boolean;
  updated_at: string;
}

export type AgentSettingsUpdate = Partial<
  Omit<AgentSettings, "id" | "agent" | "updated_at">
>;

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
    /**
     * Slack's event_id for the originating event. Used as the
     * concurrency key on the georges-checkin function so two
     * Slack retries with the same event_id can never produce two
     * conversations.
     */
    slack_event_id: string;
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

export interface TeamMemberJoinedEvent {
  name: "tamtam/team.member-joined";
  data: {
    user_id: string;
    channel: string;
    event_ts: string;
  };
}

export interface StatusRotationEvent {
  name: "tamtam/status.rotate";
  data: { trigger: "cron" | "manual" };
}

/* -------------------------------------------------------------------------- */
/*  Session 5B — Kofi autonomous events                                       */
/* -------------------------------------------------------------------------- */

export interface KofiDailyProspectingEvent {
  name: "tamtam/kofi.prospecting";
  data: { trigger: "cron" | "manual" };
}

export interface KofiResponseMonitorEvent {
  name: "tamtam/kofi.response-monitor";
  data: { trigger: "cron" | "manual" };
}

export interface KofiEmailRepliedEvent {
  name: "tamtam/kofi.email-replied";
  data: {
    /** Lead id when we can resolve it from the recipient address. */
    lead_id: string | null;
    from_email: string;
    subject: string;
    text: string;
    received_at: string;
  };
}

export interface GrowthThreadReplyEvent {
  name: "tamtam/growth.thread-reply";
  data: {
    /** The thread root ts — same as the first message's ts. */
    thread_ts: string;
    channel: string;
    user: string;
    text: string;
    /** The new reply's own ts (for dedup + Inngest event id). */
    ts: string;
    /** Slack's event_id; used as the Inngest dedup id. */
    slack_event_id: string;
  };
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
  | TeamTestReactionsEvent
  | TeamMemberJoinedEvent
  | StatusRotationEvent
  | KofiDailyProspectingEvent
  | KofiResponseMonitorEvent
  | KofiEmailRepliedEvent
  | GrowthThreadReplyEvent;
