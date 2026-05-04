/**
 * Dashboard token validation.
 *
 * Single secret guards the entire /dashboard surface — both the
 * page (`/dashboard/[token]`) and the eight API routes under
 * `/api/dashboard/*`. There is no auth, no login, no session — the
 * URL itself IS the credential.
 *
 * Security notes:
 *   - timing-safe comparison via crypto.timingSafeEqual so an
 *     attacker can't enumerate the secret via response-time
 *     differences.
 *   - When DASHBOARD_SECRET is unset, every check fails. This is
 *     by design — the dashboard returns 404 in unconfigured
 *     environments rather than letting through a permissive default.
 *   - On mismatch, callers should respond 404 (not 401) so the
 *     existence of the page isn't leaked to the wider internet.
 *
 * Caveat (called out in chat): the token travels in URL paths and
 * query strings. URLs land in Vercel access logs, browser history,
 * referrer headers, screenshots. Treat the secret as a credential —
 * if you suspect leak, regenerate.
 */

import { timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Compare a candidate token to DASHBOARD_SECRET in constant time.
 * Returns false when:
 *   - DASHBOARD_SECRET is unset
 *   - candidate is empty / undefined / wrong length
 *   - bytes don't match
 */
export function isValidDashboardToken(
  candidate: string | undefined | null,
): boolean {
  const secret = env.DASHBOARD_SECRET;
  if (!secret) return false;
  if (!candidate || candidate.length === 0) return false;

  const a = Buffer.from(candidate);
  const b = Buffer.from(secret);
  // timingSafeEqual throws on length mismatch — short-circuit
  // ourselves to keep the comparison branch-free for callers.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Pull a candidate token from a Request — `?token=` query param
 * first (the page itself uses path params; client-side fetches
 * use query/header), then `X-Dashboard-Token` header.
 */
export function readTokenFromRequest(req: Request): string | null {
  try {
    const url = new URL(req.url);
    const fromQuery = url.searchParams.get("token");
    if (fromQuery) return fromQuery;
  } catch {
    /* ignore — fall through to header */
  }
  return req.headers.get("x-dashboard-token");
}

/**
 * Convenience wrapper: returns true if the request carries a valid
 * dashboard token via query or header.
 */
export function isAuthorisedDashboardRequest(req: Request): boolean {
  return isValidDashboardToken(readTokenFromRequest(req));
}
