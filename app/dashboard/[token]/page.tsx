/**
 * Dashboard page — server-side token gate, then handoff to the
 * client shell. The token never reaches a client component as a
 * URL string-of-truth; it's passed in as a prop, used to sign
 * each /api/dashboard/* fetch via ?token=… query.
 *
 * Auth model: validate against DASHBOARD_SECRET via timing-safe
 * comparison. On mismatch (or unset secret), `notFound()` returns
 * a real 404 — the page doesn't exist as far as the wider internet
 * is concerned.
 */

import { notFound } from "next/navigation";
import { isValidDashboardToken } from "@/lib/dashboard-auth";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

// Force dynamic rendering — the page result depends on the env
// secret, never cache.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function DashboardPage({
  params,
}: {
  params: { token: string };
}): JSX.Element {
  if (!isValidDashboardToken(params.token)) {
    notFound();
  }
  return <DashboardShell token={params.token} />;
}
