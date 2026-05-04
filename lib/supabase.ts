/**
 * Supabase client wrappers.
 *
 * - `getSupabaseAdmin()` returns a service-role client for server-side
 *   agent work (bypasses RLS, used by Inngest jobs and route handlers).
 * - `getSupabaseAnon()` returns the public anon client for any future
 *   browser surface.
 *
 * We export typed helpers (`logAgentAction`, `recordApproval`, etc.) so
 * agents never touch raw table strings in business logic.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";
import type { Database } from "@/types/database";
import type {
  AgentLog,
  AgentLogInsert,
  AgentName,
  Approval,
  ApprovalDecision,
  ApprovalInsert,
  ApprovalPayload,
  ApprovalType,
  EmailMessage,
  EmailMessageInsert,
  Lead,
  LeadInsert,
  LeadResponseClassification,
  LeadStatus,
  Post,
  PostInsert,
  PostStatus,
} from "@/types";

/**
 * Typed against `types/database.ts` (a hand-written stand-in for the
 * `supabase gen types typescript` output). Replace `types/database.ts`
 * with the CLI-generated file and this module continues to compile.
 */
type Client = SupabaseClient<Database>;

let adminSingleton: Client | null = null;
let anonSingleton: Client | null = null;

export function getSupabaseAdmin(): Client {
  if (adminSingleton) return adminSingleton;
  adminSingleton = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-tamtam-client": "agents-admin" } },
    },
  );
  return adminSingleton;
}

export function getSupabaseAnon(): Client {
  if (anonSingleton) return anonSingleton;
  anonSingleton = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-tamtam-client": "agents-anon" } },
    },
  );
  return anonSingleton;
}

/* -------------------------------------------------------------------------- */
/*  Logging                                                                   */
/* -------------------------------------------------------------------------- */

export async function logAgentAction(
  entry: AgentLogInsert,
): Promise<AgentLog> {
  const { data, error } = await getSupabaseAdmin()
    .from("agent_logs")
    .insert({
      agent: entry.agent,
      action: entry.action,
      metadata: entry.metadata as Database["public"]["Tables"]["agent_logs"]["Insert"]["metadata"],
      status: entry.status,
    })
    .select()
    .single();

  if (error) {
    throw new Error(
      `[supabase] logAgentAction failed (${entry.agent}/${entry.action}): ${error.message}`,
    );
  }
  return data as unknown as AgentLog;
}

export async function getRecentAgentLogs(
  agent: AgentName,
  sinceISO: string,
): Promise<AgentLog[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("agent_logs")
    .select("*")
    .eq("agent", agent)
    .gte("created_at", sinceISO)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(
      `[supabase] getRecentAgentLogs(${agent}) failed: ${error.message}`,
    );
  }
  return (data ?? []) as unknown as AgentLog[];
}

/* -------------------------------------------------------------------------- */
/*  Posts                                                                     */
/* -------------------------------------------------------------------------- */

export async function createPost(input: PostInsert): Promise<Post> {
  const { data, error } = await getSupabaseAdmin()
    .from("posts")
    .insert({
      platform: input.platform,
      caption: input.caption,
      image_url: input.image_url,
      image_prompt: input.image_prompt,
      scheduled_at: input.scheduled_at,
      status: input.status,
      post_id: input.post_id,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`[supabase] createPost failed: ${error.message}`);
  }
  return data as unknown as Post;
}

export async function getPost(postId: string): Promise<Post> {
  const { data, error } = await getSupabaseAdmin()
    .from("posts")
    .select("*")
    .eq("id", postId)
    .single();

  if (error) {
    throw new Error(`[supabase] getPost(${postId}) failed: ${error.message}`);
  }
  return data as unknown as Post;
}

export async function updatePostStatus(input: {
  postId: string;
  status: PostStatus;
  externalPostId?: string | null;
}): Promise<Post> {
  const { data, error } = await getSupabaseAdmin()
    .from("posts")
    .update({
      status: input.status,
      ...(input.externalPostId !== undefined
        ? { post_id: input.externalPostId }
        : {}),
    })
    .eq("id", input.postId)
    .select()
    .single();

  if (error) {
    throw new Error(
      `[supabase] updatePostStatus(${input.postId}) failed: ${error.message}`,
    );
  }
  return data as unknown as Post;
}

/* -------------------------------------------------------------------------- */
/*  Leads                                                                     */
/* -------------------------------------------------------------------------- */

export async function upsertLead(input: LeadInsert): Promise<Lead> {
  // Idempotent on (company, email) when email is present, otherwise on company
  // alone. We do this with a regular insert/update split because Supabase
  // upsert needs a unique constraint declared in the DB and we don't want to
  // assume one exists yet.
  const supabase = getSupabaseAdmin();
  const existingQuery = supabase
    .from("leads")
    .select("*")
    .eq("company", input.company);

  if (input.email) existingQuery.eq("email", input.email);

  const { data: existing, error: lookupErr } = await existingQuery.maybeSingle();
  if (lookupErr) {
    throw new Error(`[supabase] upsertLead lookup failed: ${lookupErr.message}`);
  }

  if (existing) {
    const { data, error } = await supabase
      .from("leads")
      .update({
        contact_name: input.contact_name ?? null,
        contact_title: input.contact_title ?? null,
        email: input.email ?? null,
        status: input.status ?? "new",
        last_contact_at: input.last_contact_at ?? null,
        notes: input.notes ?? null,
        intent_signal: input.intent_signal ?? null,
        confidence_score: input.confidence_score ?? null,
        awa_warmup: input.awa_warmup ?? false,
        outreach_channel: input.outreach_channel ?? null,
        why_now: input.why_now ?? null,
        linkedin_url: input.linkedin_url ?? null,
      })
      .eq("id", (existing as { id: string }).id)
      .select()
      .single();
    if (error) {
      throw new Error(`[supabase] upsertLead update failed: ${error.message}`);
    }
    return data as unknown as Lead;
  }

  const { data, error } = await supabase
    .from("leads")
    .insert({
      company: input.company,
      contact_name: input.contact_name ?? null,
      contact_title: input.contact_title ?? null,
      email: input.email ?? null,
      status: input.status ?? "new",
      last_contact_at: input.last_contact_at ?? null,
      notes: input.notes ?? null,
      intent_signal: input.intent_signal ?? null,
      confidence_score: input.confidence_score ?? null,
      awa_warmup: input.awa_warmup ?? false,
      outreach_channel: input.outreach_channel ?? null,
      why_now: input.why_now ?? null,
      linkedin_url: input.linkedin_url ?? null,
    })
    .select()
    .single();
  if (error) {
    throw new Error(`[supabase] upsertLead insert failed: ${error.message}`);
  }
  return data as unknown as Lead;
}

/* -------------------------------------------------------------------------- */
/*  Lead lifecycle (Session 5B — Kofi autonomous)                             */
/* -------------------------------------------------------------------------- */

/**
 * Leads `last_contact_at` was N days ago and we haven't yet sent
 * the day-N follow-up. The N=4 / N=9 shape mirrors Kofi's cadence.
 */
async function getLeadsAtDayOffset(
  daysAgo: number,
  followupColumn: "day4_sent_at" | "day9_sent_at",
): Promise<Lead[]> {
  const targetDay = new Date();
  targetDay.setUTCDate(targetDay.getUTCDate() - daysAgo);
  const startOfDay = new Date(targetDay);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(targetDay);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const { data, error } = await getSupabaseAdmin()
    .from("leads")
    .select("*")
    .eq("status", "contacted")
    .is(followupColumn, null)
    .gte("last_contact_at", startOfDay.toISOString())
    .lte("last_contact_at", endOfDay.toISOString());

  if (error) {
    throw new Error(
      `[supabase] getLeadsAtDayOffset(${daysAgo}) failed: ${error.message}`,
    );
  }
  return (data ?? []) as unknown as Lead[];
}

export function getLeadsNeedingDay4Followup(): Promise<Lead[]> {
  return getLeadsAtDayOffset(4, "day4_sent_at");
}

export function getLeadsNeedingDay9Followup(): Promise<Lead[]> {
  return getLeadsAtDayOffset(9, "day9_sent_at");
}

/**
 * Leads still in 'contacted' beyond day 9 — these go cold and
 * stop receiving outreach.
 */
export async function getLeadsToMarkCold(): Promise<Lead[]> {
  const tenDaysAgo = new Date();
  tenDaysAgo.setUTCDate(tenDaysAgo.getUTCDate() - 10);
  const { data, error } = await getSupabaseAdmin()
    .from("leads")
    .select("*")
    .eq("status", "contacted")
    .lt("last_contact_at", tenDaysAgo.toISOString());

  if (error) {
    throw new Error(`[supabase] getLeadsToMarkCold failed: ${error.message}`);
  }
  return (data ?? []) as unknown as Lead[];
}

export async function markFollowupSent(input: {
  leadId: string;
  which: "day4" | "day9";
}): Promise<void> {
  const column = input.which === "day4" ? "day4_sent_at" : "day9_sent_at";
  const now = new Date().toISOString();
  const { error } = await getSupabaseAdmin()
    .from("leads")
    .update({
      [column]: now,
      last_contact_at: now,
    } as never)
    .eq("id", input.leadId);

  if (error) {
    throw new Error(
      `[supabase] markFollowupSent(${input.leadId}, ${input.which}) failed: ${error.message}`,
    );
  }
}

export async function setLeadResponseClassification(input: {
  leadId: string;
  classification: LeadResponseClassification;
  status: Lead["status"];
  responseNote?: string;
}): Promise<Lead> {
  const supabase = getSupabaseAdmin();
  const update: Record<string, unknown> = {
    response_classification: input.classification,
    status: input.status,
  };
  if (input.responseNote) {
    // Append to notes, don't overwrite — preserve Kofi's research.
    const existing = await getLead(input.leadId);
    update.notes =
      (existing.notes ? existing.notes + "\n\n" : "") +
      `[${new Date().toISOString()}] response (${input.classification}): ${input.responseNote}`;
  }

  const { data, error } = await supabase
    .from("leads")
    .update(update as never)
    .eq("id", input.leadId)
    .select()
    .single();
  if (error) {
    throw new Error(
      `[supabase] setLeadResponseClassification(${input.leadId}) failed: ${error.message}`,
    );
  }
  return data as unknown as Lead;
}

export async function markLeadEscalated(leadId: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("leads")
    .update({
      escalated_to_georges: true,
      escalated_at: new Date().toISOString(),
    } as never)
    .eq("id", leadId);
  if (error) {
    throw new Error(
      `[supabase] markLeadEscalated(${leadId}) failed: ${error.message}`,
    );
  }
}

/**
 * Find a lead by recipient email. Used by the email-reply webhook
 * to associate the inbound message with the right Kofi conversation.
 * Returns null if no match (still ingest the reply for audit).
 */
export async function findLeadByEmail(email: string): Promise<Lead | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("leads")
    .select("*")
    .eq("email", email)
    .order("last_contact_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn(
      `[supabase] findLeadByEmail(${email}) failed: ${error.message}`,
    );
    return null;
  }
  return (data ?? null) as unknown as Lead | null;
}

export async function getLead(leadId: string): Promise<Lead> {
  const { data, error } = await getSupabaseAdmin()
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .single();

  if (error) {
    throw new Error(`[supabase] getLead(${leadId}) failed: ${error.message}`);
  }
  return data as unknown as Lead;
}

export async function setLeadStatus(
  leadId: string,
  status: Lead["status"],
  opts: { lastContactAt?: string } = {},
): Promise<Lead> {
  const { data, error } = await getSupabaseAdmin()
    .from("leads")
    .update({
      status,
      ...(opts.lastContactAt ? { last_contact_at: opts.lastContactAt } : {}),
    })
    .eq("id", leadId)
    .select()
    .single();

  if (error) {
    throw new Error(
      `[supabase] setLeadStatus(${leadId}) failed: ${error.message}`,
    );
  }
  return data as unknown as Lead;
}

/* -------------------------------------------------------------------------- */
/*  Approvals                                                                 */
/* -------------------------------------------------------------------------- */

export async function createApproval(input: {
  agent: AgentName;
  type: ApprovalType;
  payload: ApprovalPayload;
}): Promise<Approval> {
  const insert: ApprovalInsert = {
    agent: input.agent,
    type: input.type,
    payload: input.payload,
    slack_message_ts: null,
    decision: "pending",
  };

  const { data, error } = await getSupabaseAdmin()
    .from("approvals")
    .insert({
      agent: insert.agent,
      type: insert.type,
      payload: insert.payload as Database["public"]["Tables"]["approvals"]["Insert"]["payload"],
      slack_message_ts: insert.slack_message_ts,
      decision: insert.decision,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`[supabase] createApproval failed: ${error.message}`);
  }
  return data as unknown as Approval;
}

export async function attachSlackTsToApproval(
  approvalId: string,
  slackMessageTs: string,
): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("approvals")
    .update({ slack_message_ts: slackMessageTs })
    .eq("id", approvalId);

  if (error) {
    throw new Error(
      `[supabase] attachSlackTsToApproval(${approvalId}) failed: ${error.message}`,
    );
  }
}

export async function getApproval(approvalId: string): Promise<Approval> {
  const { data, error } = await getSupabaseAdmin()
    .from("approvals")
    .select("*")
    .eq("id", approvalId)
    .single();

  if (error) {
    throw new Error(
      `[supabase] getApproval(${approvalId}) failed: ${error.message}`,
    );
  }
  return data as unknown as Approval;
}

export async function setApprovalDecision(
  approvalId: string,
  decision: Exclude<ApprovalDecision, "pending">,
): Promise<Approval> {
  const { data, error } = await getSupabaseAdmin()
    .from("approvals")
    .update({ decision })
    .eq("id", approvalId)
    .select()
    .single();

  if (error) {
    throw new Error(
      `[supabase] setApprovalDecision(${approvalId}) failed: ${error.message}`,
    );
  }
  return data as unknown as Approval;
}

export async function getPendingApprovals(): Promise<Approval[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("approvals")
    .select("*")
    .eq("decision", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`[supabase] getPendingApprovals failed: ${error.message}`);
  }
  return (data ?? []) as unknown as Approval[];
}

/* -------------------------------------------------------------------------- */
/*  Email messages (Session 5C — outbound audit trail)                        */
/* -------------------------------------------------------------------------- */

export async function saveEmailMessage(
  input: EmailMessageInsert,
): Promise<EmailMessage> {
  const { data, error } = await getSupabaseAdmin()
    .from("email_messages")
    .insert(input)
    .select()
    .single();
  if (error) {
    throw new Error(`[supabase] saveEmailMessage failed: ${error.message}`);
  }
  return data as unknown as EmailMessage;
}

/**
 * Most-recent outbound email_messages row for a lead. Used by
 * day-4 / day-9 generators to thread `Re: <subject>` correctly.
 * Returns null if no email has ever been logged for the lead.
 */
export async function getLastOutboundEmailToLead(
  leadId: string,
): Promise<EmailMessage | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("email_messages")
    .select("*")
    .eq("lead_id", leadId)
    .eq("direction", "outbound")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn(
      `[supabase] getLastOutboundEmailToLead(${leadId}) failed: ${error.message}`,
    );
    return null;
  }
  return (data ?? null) as unknown as EmailMessage | null;
}

/* -------------------------------------------------------------------------- */
/*  Pipeline admin (Session 5C — Georges natural-language updates)            */
/* -------------------------------------------------------------------------- */

/**
 * Find a lead by case-insensitive partial company name. Used when
 * Georges types "Wave Sénégal replied" and we need to map that to
 * a row in `leads`. Returns the most recently contacted match
 * when there are duplicates.
 */
export async function findLeadByCompany(
  companyQuery: string,
): Promise<Lead | null> {
  // Postgres `ILIKE` is case-insensitive; %company% matches partials.
  const { data, error } = await getSupabaseAdmin()
    .from("leads")
    .select("*")
    .ilike("company", `%${companyQuery}%`)
    .order("last_contact_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn(
      `[supabase] findLeadByCompany(${companyQuery}) failed: ${error.message}`,
    );
    return null;
  }
  return (data ?? null) as unknown as Lead | null;
}

export async function updateLeadStatusByCompany(input: {
  companyQuery: string;
  status: LeadStatus;
  classification?: LeadResponseClassification;
  noteAppend?: string;
}): Promise<Lead | null> {
  const lead = await findLeadByCompany(input.companyQuery);
  if (!lead) return null;

  const update: Record<string, unknown> = { status: input.status };
  if (input.classification) {
    update.response_classification = input.classification;
  }
  if (input.noteAppend) {
    update.notes =
      (lead.notes ? lead.notes + "\n\n" : "") +
      `[${new Date().toISOString()}] ${input.noteAppend}`;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("leads")
    .update(update as never)
    .eq("id", lead.id)
    .select()
    .single();
  if (error) {
    throw new Error(
      `[supabase] updateLeadStatusByCompany(${input.companyQuery}) failed: ${error.message}`,
    );
  }
  return data as unknown as Lead;
}

export interface PipelineSnapshot {
  hot: Lead[];
  warm: Lead[];
  contacted: Lead[];
  paused: Lead[];
  cold: Lead[];
  converted: Lead[];
  apollo_credits_used: number;
  apollo_credits_remaining: number;
}

/**
 * Snapshot of the leads pipeline grouped by status, plus the
 * monthly Apollo credit counter. Read-only — does not mutate
 * anything. Used by Kofi's `get_pipeline_summary` tool.
 */
export async function getPipelineSnapshot(): Promise<PipelineSnapshot> {
  const { data: rows, error } = await getSupabaseAdmin()
    .from("leads")
    .select("*")
    .in("status", [
      "hot",
      "warm",
      "contacted",
      "paused",
      "cold",
      "converted",
    ])
    .order("last_contact_at", { ascending: false, nullsFirst: false });

  if (error) {
    throw new Error(`[supabase] getPipelineSnapshot failed: ${error.message}`);
  }

  const all = (rows ?? []) as unknown as Lead[];
  const buckets = (s: Lead["status"]): Lead[] =>
    all.filter((r) => r.status === s);

  // Reuse the Apollo logger helper inline so this file stays
  // self-contained (no circular import with lib/apollo.ts).
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { count: creditCount } = await getSupabaseAdmin()
    .from("agent_logs")
    .select("id", { count: "exact", head: true })
    .eq("agent", "growth")
    .eq("action", "apollo.credit_used")
    .gte("created_at", monthStart.toISOString());

  const used = creditCount ?? 0;
  return {
    hot: buckets("hot"),
    warm: buckets("warm"),
    contacted: buckets("contacted"),
    paused: buckets("paused"),
    cold: buckets("cold"),
    converted: buckets("converted"),
    apollo_credits_used: used,
    apollo_credits_remaining: Math.max(0, 70 - used),
  };
}

/* -------------------------------------------------------------------------- */
/*  Storage                                                                   */
/* -------------------------------------------------------------------------- */

export async function uploadImageToStorage(input: {
  pathInBucket: string;
  bytes: ArrayBuffer | Uint8Array | Buffer;
  contentType: string;
}): Promise<{ path: string; publicUrl: string }> {
  const bucket = env.SUPABASE_STORAGE_BUCKET;
  const supabase = getSupabaseAdmin();

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(input.pathInBucket, input.bytes, {
      contentType: input.contentType,
      upsert: true,
    });

  if (uploadError) {
    throw new Error(
      `[supabase] uploadImageToStorage(${input.pathInBucket}) failed: ${uploadError.message}`,
    );
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(input.pathInBucket);
  return { path: input.pathInBucket, publicUrl: data.publicUrl };
}

/* -------------------------------------------------------------------------- */
/*  Health check                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Lightweight connectivity check used at boot / from a debug endpoint.
 * Does not throw — returns a structured result so callers can degrade
 * gracefully instead of crashing the process.
 */
export async function pingSupabase(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  try {
    const { error } = await getSupabaseAdmin()
      .from("agent_logs")
      .select("id", { count: "exact", head: true });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
