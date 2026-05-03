/**
 * Supabase Database type.
 *
 * Hand-written to match the exact shape `supabase gen types typescript`
 * produces, so this file is a drop-in replacement target. Once the
 * Supabase project is provisioned and the CLI is authenticated, run:
 *
 *   npx supabase gen types typescript \
 *     --project-id <ref> > types/database.ts
 *
 * and this hand-written version goes away.
 *
 * IMPORTANT: every Table must declare `Row`, `Insert`, `Update`, AND
 * `Relationships`. The schema must declare `Tables`, `Views`, `Functions`,
 * `Enums`, and `CompositeTypes`. Missing fields cause @supabase/postgrest-js
 * to widen Schema to `never`, which breaks the .insert()/.update() chain.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "12";
  };
  public: {
    Tables: {
      agent_logs: {
        Row: {
          id: string;
          agent: "social" | "growth" | "coo";
          action: string;
          metadata: Json;
          status: "started" | "completed" | "failed" | "skipped";
          created_at: string;
        };
        Insert: {
          id?: string;
          agent: "social" | "growth" | "coo";
          action: string;
          metadata?: Json;
          status: "started" | "completed" | "failed" | "skipped";
          created_at?: string;
        };
        Update: {
          id?: string;
          agent?: "social" | "growth" | "coo";
          action?: string;
          metadata?: Json;
          status?: "started" | "completed" | "failed" | "skipped";
          created_at?: string;
        };
        Relationships: [];
      };
      posts: {
        Row: {
          id: string;
          platform: "linkedin";
          caption: string;
          image_url: string | null;
          image_prompt: string | null;
          scheduled_at: string | null;
          status:
            | "draft"
            | "pending_approval"
            | "approved"
            | "rejected"
            | "scheduled"
            | "published"
            | "failed";
          post_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          platform: "linkedin";
          caption: string;
          image_url?: string | null;
          image_prompt?: string | null;
          scheduled_at?: string | null;
          status?:
            | "draft"
            | "pending_approval"
            | "approved"
            | "rejected"
            | "scheduled"
            | "published"
            | "failed";
          post_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          platform?: "linkedin";
          caption?: string;
          image_url?: string | null;
          image_prompt?: string | null;
          scheduled_at?: string | null;
          status?:
            | "draft"
            | "pending_approval"
            | "approved"
            | "rejected"
            | "scheduled"
            | "published"
            | "failed";
          post_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      leads: {
        Row: {
          id: string;
          company: string;
          contact_name: string | null;
          contact_title: string | null;
          email: string | null;
          status:
            | "new"
            | "researching"
            | "researched"
            | "queued"
            | "contacted"
            | "warm"
            | "replied"
            | "cold"
            | "rejected"
            | "won"
            | "lost"
            | "do_not_contact";
          last_contact_at: string | null;
          notes: string | null;
          created_at: string;
          intent_signal: string | null;
          confidence_score: number | null;
          awa_warmup: boolean;
          outreach_channel: "linkedin" | "email" | "both" | null;
          why_now: string | null;
          linkedin_url: string | null;
          linkedin_message_id: string | null;
          day4_sent_at: string | null;
          day9_sent_at: string | null;
          response_classification:
            | "positive"
            | "neutral"
            | "negative"
            | "referral"
            | null;
          escalated_to_georges: boolean;
          escalated_at: string | null;
        };
        Insert: {
          id?: string;
          company: string;
          contact_name?: string | null;
          contact_title?: string | null;
          email?: string | null;
          status?:
            | "new"
            | "researching"
            | "researched"
            | "queued"
            | "contacted"
            | "warm"
            | "replied"
            | "cold"
            | "rejected"
            | "won"
            | "lost"
            | "do_not_contact";
          last_contact_at?: string | null;
          notes?: string | null;
          created_at?: string;
          intent_signal?: string | null;
          confidence_score?: number | null;
          awa_warmup?: boolean;
          outreach_channel?: "linkedin" | "email" | "both" | null;
          why_now?: string | null;
          linkedin_url?: string | null;
          linkedin_message_id?: string | null;
          day4_sent_at?: string | null;
          day9_sent_at?: string | null;
          response_classification?:
            | "positive"
            | "neutral"
            | "negative"
            | "referral"
            | null;
          escalated_to_georges?: boolean;
          escalated_at?: string | null;
        };
        Update: {
          id?: string;
          company?: string;
          contact_name?: string | null;
          contact_title?: string | null;
          email?: string | null;
          status?:
            | "new"
            | "researching"
            | "researched"
            | "queued"
            | "contacted"
            | "warm"
            | "replied"
            | "cold"
            | "rejected"
            | "won"
            | "lost"
            | "do_not_contact";
          last_contact_at?: string | null;
          notes?: string | null;
          created_at?: string;
          intent_signal?: string | null;
          confidence_score?: number | null;
          awa_warmup?: boolean;
          outreach_channel?: "linkedin" | "email" | "both" | null;
          why_now?: string | null;
          linkedin_url?: string | null;
          linkedin_message_id?: string | null;
          day4_sent_at?: string | null;
          day9_sent_at?: string | null;
          response_classification?:
            | "positive"
            | "neutral"
            | "negative"
            | "referral"
            | null;
          escalated_to_georges?: boolean;
          escalated_at?: string | null;
        };
        Relationships: [];
      };
      approvals: {
        Row: {
          id: string;
          agent: "social" | "growth" | "coo";
          type:
            | "linkedin_post"
            | "outreach_email"
            | "lead_addition"
            | "other";
          payload: Json;
          slack_message_ts: string | null;
          decision:
            | "pending"
            | "approved"
            | "rejected"
            | "edited"
            | "expired";
          created_at: string;
        };
        Insert: {
          id?: string;
          agent: "social" | "growth" | "coo";
          type:
            | "linkedin_post"
            | "outreach_email"
            | "lead_addition"
            | "other";
          payload: Json;
          slack_message_ts?: string | null;
          decision?:
            | "pending"
            | "approved"
            | "rejected"
            | "edited"
            | "expired";
          created_at?: string;
        };
        Update: {
          id?: string;
          agent?: "social" | "growth" | "coo";
          type?:
            | "linkedin_post"
            | "outreach_email"
            | "lead_addition"
            | "other";
          payload?: Json;
          slack_message_ts?: string | null;
          decision?:
            | "pending"
            | "approved"
            | "rejected"
            | "edited"
            | "expired";
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
