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
/*  Supabase Database type (used by @supabase/supabase-js generics)           */
/* -------------------------------------------------------------------------- */

export interface Database {
  // Required by @supabase/postgrest-js v1.20+ to enable schema inference
  // (otherwise the Tables get widened to `never`).
  __InternalSupabase: { PostgrestVersion: "12" };
  public: {
    Tables: {
      agent_logs: {
        Row: AgentLog;
        Insert: AgentLogInsert;
        Update: Partial<AgentLogInsert>;
        Relationships: [];
      };
      posts: {
        Row: Post;
        Insert: PostInsert;
        Update: Partial<PostInsert>;
        Relationships: [];
      };
      leads: {
        Row: Lead;
        Insert: LeadInsert;
        Update: Partial<LeadInsert>;
        Relationships: [];
      };
      approvals: {
        Row: Approval;
        Insert: ApprovalInsert;
        Update: Partial<ApprovalInsert>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

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
/* -------------------------------------------------------------------------- */

export interface SocialJobEvent {
  name: "agents/social.run";
  data: {
    trigger: "manual" | "cron" | "approval";
    /** Optional brief from Georges or COO that seeds the post. */
    brief?: string;
  };
}

export interface GrowthJobEvent {
  name: "agents/growth.run";
  data: {
    trigger: "manual" | "cron" | "approval";
    lead_id?: string;
  };
}

export interface CooJobEvent {
  name: "agents/coo.tick";
  data: {
    trigger: "cron" | "manual";
  };
}

export interface ApprovalDecisionEvent {
  name: "approvals/decision";
  data: {
    approval_id: string;
    decision: Exclude<ApprovalDecision, "pending">;
  };
}

export type AppInngestEvent =
  | SocialJobEvent
  | GrowthJobEvent
  | CooJobEvent
  | ApprovalDecisionEvent;
