/**
 * Inngest function: Rama's Friday wrap-up.
 *
 * Cron: 17:00 UTC, Fridays. Reads the past 7 days of agent_logs,
 * tallies posts/leads/emails/approvals, hands the summary to Rama
 * and asks her to write the wrap-up in her voice.
 *
 * Also responds to `tamtam/team.friday-wrapup` for manual triggers.
 */

import { inngest } from "@/lib/inngest";
import { getRecentAgentLogs, logAgentAction } from "@/lib/supabase";
import { speakAs } from "@/lib/team-voice";
import type { AgentLog } from "@/types";

interface WeeklyTotals {
  posts_published: number;
  leads_researched: number;
  emails_sent: number;
  approvals_granted: number;
  approvals_rejected: number;
  failures: number;
}

function tally(logs: AgentLog[]): WeeklyTotals {
  const totals: WeeklyTotals = {
    posts_published: 0,
    leads_researched: 0,
    emails_sent: 0,
    approvals_granted: 0,
    approvals_rejected: 0,
    failures: 0,
  };
  for (const r of logs) {
    if (r.status === "failed") totals.failures += 1;
    switch (r.action) {
      case "publish.completed":
        totals.posts_published += 1;
        break;
      case "tool.research_lead.completed":
        totals.leads_researched += 1;
        break;
      case "outreach.send.completed":
        totals.emails_sent += 1;
        break;
      case "approval.approved":
        totals.approvals_granted += 1;
        break;
      case "approval.rejected":
        totals.approvals_rejected += 1;
        break;
    }
  }
  return totals;
}

export const fridayWrapup = inngest.createFunction(
  { id: "friday-wrapup", name: "Rama — weekly wrap-up in #tamtam-team" },
  [
    { cron: "0 17 * * 5" }, // Fridays 17:00 UTC
    { event: "tamtam/team.friday-wrapup" },
  ],
  async ({ step }) => {
    return step.run("post-wrapup", async () => {
      const since = new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const [socialLogs, growthLogs, cooLogs] = await Promise.all([
        getRecentAgentLogs("social", since),
        getRecentAgentLogs("growth", since),
        getRecentAgentLogs("coo", since),
      ]);

      const totals = tally([...socialLogs, ...growthLogs, ...cooLogs]);

      const brief =
        `It is Friday evening. Compose a weekly wrap-up for ` +
        `#tamtam-team in your voice. Cover: what shipped, what shifted, ` +
        `the highlight moment, one thing the team should do differently ` +
        `next week, and a warm close that names Georges specifically. ` +
        `8 lines max. No bullet lists — this is a message, not a report.\n\n` +
        `Tallies for the last 7 days:\n` +
        `  posts_published:    ${totals.posts_published}\n` +
        `  leads_researched:   ${totals.leads_researched}\n` +
        `  emails_sent:        ${totals.emails_sent}\n` +
        `  approvals_granted:  ${totals.approvals_granted}\n` +
        `  approvals_rejected: ${totals.approvals_rejected}\n` +
        `  failures:           ${totals.failures}\n` +
        `  social_log_rows:    ${socialLogs.length}\n` +
        `  growth_log_rows:    ${growthLogs.length}\n` +
        `  coo_log_rows:       ${cooLogs.length}`;

      const res = await speakAs({
        agent: "coo",
        brief,
        source: "friday_wrapup",
        maxTokens: 500,
      });

      if (!res.posted) {
        await logAgentAction({
          agent: "coo",
          action: "team.friday_wrapup.skipped",
          metadata: { reason: res.reason, totals },
          status: "skipped",
        });
      }
      return { ...res, totals };
    });
  },
);
