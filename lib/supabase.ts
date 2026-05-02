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
  Lead,
  LeadInsert,
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
        email: input.email ?? null,
        status: input.status ?? "new",
        last_contact_at: input.last_contact_at ?? null,
        notes: input.notes ?? null,
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
      email: input.email ?? null,
      status: input.status ?? "new",
      last_contact_at: input.last_contact_at ?? null,
      notes: input.notes ?? null,
    })
    .select()
    .single();
  if (error) {
    throw new Error(`[supabase] upsertLead insert failed: ${error.message}`);
  }
  return data as unknown as Lead;
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
