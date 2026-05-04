/**
 * Apollo.io integration — credit-aware lead enrichment.
 *
 * Apollo's free tier ships 75 credits/month. Tamtam targets ~10
 * leads/day × 22 working days = ~220 lead-research events/month —
 * Apollo can verify ~75 of them. We therefore:
 *
 *   1. Track every credit-using call in agent_logs with action
 *      "apollo.credit_used". `getMonthlyCreditsUsed()` counts
 *      those rows for the current calendar month.
 *   2. Reserve a 5-credit buffer — once usage ≥ 70, we stop
 *      calling and return null. Caller (`kofi-daily-prospecting`)
 *      surfaces a warning in #tamtam-growth instead of failing.
 *   3. Never throw. All errors fall through to `null` so an
 *      Apollo outage / quota hit / network blip doesn't take
 *      Kofi's morning run down with it.
 *
 * If APOLLO_API_KEY is unset everything no-ops with null.
 */

import { env } from "./env";
import { getSupabaseAdmin, logAgentAction } from "./supabase";

/** Hard ceiling — leave 5-credit buffer below the 75/month free tier. */
const APOLLO_MONTHLY_HARD_CEILING = 70;

const APOLLO_BASE_URL = "https://api.apollo.io/v1";

export interface ApolloPersonResult {
  /** Apollo's person id; pass to revealPerson if email is missing. */
  id: string | null;
  name: string | null;
  title: string | null;
  email: string | null;
  linkedin_url: string | null;
}

/**
 * Apollo's `mixed_people/search` sometimes returns obfuscated
 * emails ("email_not_unlocked@domain.com") on the free tier.
 * Use this to detect those before relying on the value.
 */
export function looksLikeRealEmail(email: string | null): boolean {
  if (!email) return false;
  const lower = email.toLowerCase();
  if (lower.includes("email_not_unlocked")) return false;
  if (lower.includes("not_unlocked")) return false;
  if (lower.startsWith("**")) return false;
  // basic shape check
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export interface ApolloCompanyResult {
  name: string | null;
  industry: string | null;
  employee_count: number | null;
  short_description: string | null;
}

/**
 * Count of credit-using Apollo calls so far this calendar month
 * (UTC). Reads agent_logs — keep this in sync with the logging
 * we do inside this module.
 */
export async function getMonthlyCreditsUsed(): Promise<number> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const { count, error } = await getSupabaseAdmin()
    .from("agent_logs")
    .select("id", { count: "exact", head: true })
    .eq("agent", "growth")
    .eq("action", "apollo.credit_used")
    .gte("created_at", monthStart.toISOString());

  if (error) {
    // Failing to read the counter is not a reason to spend more
    // credits we might not have. Treat as "ceiling reached".
    console.warn(
      `[apollo] getMonthlyCreditsUsed failed: ${error.message} — ` +
        `treating as ceiling.`,
    );
    return APOLLO_MONTHLY_HARD_CEILING + 1;
  }
  return count ?? 0;
}

/**
 * Returns the remaining headroom on the free tier (with the
 * 5-credit safety buffer baked in). May be ≤ 0.
 */
export async function getCreditsRemaining(): Promise<number> {
  const used = await getMonthlyCreditsUsed();
  return APOLLO_MONTHLY_HARD_CEILING - used;
}

interface ApolloPeopleSearchResponse {
  people?: Array<{
    id?: string;
    name?: string;
    title?: string;
    email?: string | null;
    linkedin_url?: string;
  }>;
}

interface ApolloPeopleMatchResponse {
  person?: {
    id?: string;
    name?: string;
    title?: string;
    email?: string | null;
    linkedin_url?: string;
  };
}

interface ApolloOrgEnrichResponse {
  organization?: {
    name?: string;
    industry?: string;
    estimated_num_employees?: number;
    short_description?: string;
  };
}

/**
 * Find a single best-match person at the given company.
 *
 * Returns null when:
 *   - APOLLO_API_KEY is unset
 *   - monthly credit ceiling reached
 *   - Apollo returns no match
 *   - the call errors for any reason
 *
 * Logs `apollo.credit_used` only when Apollo actually responded
 * (so a network failure doesn't burn a phantom credit in our books).
 */
export async function searchPeople(input: {
  company: string;
  /** Free-text titles separated by " OR ". Apollo accepts a list. */
  titles: ReadonlyArray<string>;
  /** e.g. "Senegal", "Dakar". Apollo supports country / city. */
  locations?: ReadonlyArray<string>;
}): Promise<ApolloPersonResult | null> {
  const apiKey = env.APOLLO_API_KEY;
  if (!apiKey) {
    console.log(
      "[apollo] APOLLO_API_KEY not set — enrichment skipped for:",
      input.company,
    );
    return null;
  }
  console.log(
    "[apollo] API key present — calling searchPeople for:",
    input.company,
  );

  const used = await getMonthlyCreditsUsed();
  console.log(
    `[apollo] credits used this month: ${used}/${APOLLO_MONTHLY_HARD_CEILING}`,
  );
  if (used >= APOLLO_MONTHLY_HARD_CEILING) {
    console.log(
      "[apollo] monthly ceiling reached — skipping",
      input.company,
    );
    await logAgentAction({
      agent: "growth",
      action: "apollo.skipped.ceiling",
      metadata: {
        company: input.company,
        credits_used_this_month: used,
        credits_remaining: APOLLO_MONTHLY_HARD_CEILING - used,
      },
      status: "skipped",
    }).catch(() => undefined);
    return null;
  }

  try {
    const res = await fetch(`${APOLLO_BASE_URL}/mixed_people/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify({
        q_organization_name: input.company,
        person_titles: input.titles,
        person_locations: input.locations ?? ["Senegal"],
        page: 1,
        per_page: 1,
      }),
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "(unreadable)");
      console.warn(
        `[apollo] searchPeople HTTP ${res.status} for ${input.company}: ${bodyText.slice(0, 240)}`,
      );
      return null;
    }

    const data = (await res.json()) as ApolloPeopleSearchResponse;
    const person = data.people?.[0];

    console.log(
      `[apollo] searchPeople response for ${input.company} —`,
      person
        ? `match: name=${person.name ?? "?"} title=${person.title ?? "?"} email=${person.email ?? "(none)"}`
        : "no match",
    );

    // Log the credit usage even on no-match (Apollo charged us
    // for the search either way).
    await logAgentAction({
      agent: "growth",
      action: "apollo.credit_used",
      metadata: {
        company: input.company,
        endpoint: "mixed_people/search",
        match_found: !!person,
        email_present: looksLikeRealEmail(person?.email ?? null),
        credits_used_this_month: used + 1,
        credits_remaining: APOLLO_MONTHLY_HARD_CEILING - used - 1,
      },
      status: "completed",
    }).catch(() => undefined);

    if (!person) return null;

    return {
      id: person.id ?? null,
      name: person.name ?? null,
      title: person.title ?? null,
      email: person.email ?? null,
      linkedin_url: person.linkedin_url ?? null,
    };
  } catch (err) {
    console.warn(
      `[apollo] searchPeople error for ${input.company}: ` +
        (err instanceof Error ? err.message : String(err)),
    );
    return null;
  }
}

/**
 * Reveal a person's email via Apollo's `/people/match` endpoint.
 * Used as a follow-up when `searchPeople` returned a match without
 * a usable email. Costs 1 additional credit.
 *
 * Apollo's match endpoint accepts an `id` (or a name + organisation
 * + domain combination); we pass `id` when search gave us one,
 * otherwise we fall back to name + organisation. Returns the same
 * shape as searchPeople.
 *
 * Only call this when `looksLikeRealEmail(searchResult.email)` is
 * false — otherwise you're burning a credit for no reason.
 */
export async function revealPerson(input: {
  personId?: string | null;
  name?: string | null;
  organizationName?: string | null;
  domain?: string | null;
}): Promise<ApolloPersonResult | null> {
  const apiKey = env.APOLLO_API_KEY;
  if (!apiKey) {
    console.log("[apollo] APOLLO_API_KEY not set — revealPerson skipped");
    return null;
  }

  const used = await getMonthlyCreditsUsed();
  if (used >= APOLLO_MONTHLY_HARD_CEILING) {
    console.log("[apollo] monthly ceiling reached — revealPerson skipped");
    return null;
  }

  const body: Record<string, unknown> = {
    reveal_personal_emails: false,
  };
  if (input.personId) body.id = input.personId;
  if (input.name) body.name = input.name;
  if (input.organizationName) body.organization_name = input.organizationName;
  if (input.domain) body.domain = input.domain;

  console.log(
    "[apollo] revealPerson calling /people/match with:",
    JSON.stringify(body),
  );

  try {
    const res = await fetch(`${APOLLO_BASE_URL}/people/match`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "(unreadable)");
      console.warn(
        `[apollo] revealPerson HTTP ${res.status}: ${bodyText.slice(0, 240)}`,
      );
      return null;
    }

    const data = (await res.json()) as ApolloPeopleMatchResponse;
    const person = data.person;

    console.log(
      "[apollo] revealPerson response —",
      person
        ? `name=${person.name ?? "?"} email=${person.email ?? "(still none)"}`
        : "no person on response",
    );

    await logAgentAction({
      agent: "growth",
      action: "apollo.credit_used",
      metadata: {
        endpoint: "people/match",
        match_found: !!person,
        email_revealed: looksLikeRealEmail(person?.email ?? null),
        credits_used_this_month: used + 1,
        credits_remaining: APOLLO_MONTHLY_HARD_CEILING - used - 1,
      },
      status: "completed",
    }).catch(() => undefined);

    if (!person) return null;

    return {
      id: person.id ?? null,
      name: person.name ?? null,
      title: person.title ?? null,
      email: person.email ?? null,
      linkedin_url: person.linkedin_url ?? null,
    };
  } catch (err) {
    console.warn(
      "[apollo] revealPerson error: " +
        (err instanceof Error ? err.message : String(err)),
    );
    return null;
  }
}

/**
 * Enrich a company by domain. Apollo documents this as a separate
 * endpoint that may not consume a search credit, but we log the
 * call as `apollo.credit_used` defensively — the worst case is
 * over-counting and stopping a few calls early.
 */
export async function enrichCompany(
  domain: string,
): Promise<ApolloCompanyResult | null> {
  const apiKey = env.APOLLO_API_KEY;
  if (!apiKey) return null;

  const used = await getMonthlyCreditsUsed();
  if (used >= APOLLO_MONTHLY_HARD_CEILING) return null;

  try {
    const res = await fetch(`${APOLLO_BASE_URL}/organizations/enrich`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify({ domain }),
    });

    if (!res.ok) {
      console.warn(`[apollo] enrichCompany HTTP ${res.status} for ${domain}`);
      return null;
    }

    const data = (await res.json()) as ApolloOrgEnrichResponse;
    const org = data.organization;

    await logAgentAction({
      agent: "growth",
      action: "apollo.credit_used",
      metadata: {
        domain,
        endpoint: "organizations/enrich",
        match_found: !!org,
        credits_used_this_month: used + 1,
        credits_remaining: APOLLO_MONTHLY_HARD_CEILING - used - 1,
      },
      status: "completed",
    }).catch(() => undefined);

    if (!org) return null;
    return {
      name: org.name ?? null,
      industry: org.industry ?? null,
      employee_count: org.estimated_num_employees ?? null,
      short_description: org.short_description ?? null,
    };
  } catch (err) {
    console.warn(
      `[apollo] enrichCompany error for ${domain}: ` +
        (err instanceof Error ? err.message : String(err)),
    );
    return null;
  }
}
