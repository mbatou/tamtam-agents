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
import type {
  AgentLog,
  AgentLogInsert,
  AgentName,
  Approval,
  ApprovalDecision,
  ApprovalInsert,
  ApprovalPayload,
  ApprovalType,
} from "@/types";

/**
 * NOTE: we deliberately do NOT pass a generated `Database` generic to
 * createClient. Hand-written Database types do not satisfy supabase-js
 * v2.105's strict GenericSchema constraints (interfaces don't expose the
 * required index signatures). All type safety happens at this module's
 * exported function boundaries instead. When we run `supabase gen types`
 * in Session 2+, we'll thread that generated type back through.
 */
type Client = SupabaseClient;

let adminSingleton: Client | null = null;
let anonSingleton: Client | null = null;

export function getSupabaseAdmin(): Client {
  if (adminSingleton) return adminSingleton;
  adminSingleton = createClient(
    env.SUPABASE_URL,
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
  anonSingleton = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_ANON_KEY,
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
    .insert(entry)
    .select()
    .single<AgentLog>();

  if (error) {
    throw new Error(
      `[supabase] logAgentAction failed (${entry.agent}/${entry.action}): ${error.message}`,
    );
  }
  return data;
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
    .order("created_at", { ascending: false })
    .returns<AgentLog[]>();

  if (error) {
    throw new Error(
      `[supabase] getRecentAgentLogs(${agent}) failed: ${error.message}`,
    );
  }
  return data ?? [];
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
    .insert(insert)
    .select()
    .single<Approval>();

  if (error) {
    throw new Error(`[supabase] createApproval failed: ${error.message}`);
  }
  return data;
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
    .single<Approval>();

  if (error) {
    throw new Error(
      `[supabase] getApproval(${approvalId}) failed: ${error.message}`,
    );
  }
  return data;
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
    .single<Approval>();

  if (error) {
    throw new Error(
      `[supabase] setApprovalDecision(${approvalId}) failed: ${error.message}`,
    );
  }
  return data;
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
