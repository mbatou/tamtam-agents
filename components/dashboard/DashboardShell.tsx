"use client";

import { useEffect, useState } from "react";
import { ToastProvider } from "./Toast";
import { TopNav, type DashboardTab } from "./TopNav";
import { ActivityFeed } from "./ActivityFeed";
import { PipelineTable } from "./PipelineTable";
import { ContentCalendar } from "./ContentCalendar";
import { AgentSettingsCards } from "./AgentSettings";

export function DashboardShell({ token }: { token: string }): JSX.Element {
  const [tab, setTab] = useState<DashboardTab>("feed");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Bump lastUpdated every 30s — child components fetch on the same
  // cadence so the badge in the nav reflects the actual heartbeat.
  useEffect(() => {
    setLastUpdated(new Date());
    const id = setInterval(() => setLastUpdated(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <ToastProvider>
      <div className="min-h-screen bg-dakar-bg text-dakar-text">
        <TopNav active={tab} onChange={setTab} lastUpdated={lastUpdated} />
        <main className="mx-auto max-w-7xl px-4 py-6">
          {tab === "feed" && <ActivityFeed token={token} />}
          {tab === "pipeline" && <PipelineTable token={token} />}
          {tab === "content" && <ContentCalendar token={token} />}
          {tab === "settings" && <AgentSettingsCards token={token} />}
        </main>
      </div>
    </ToastProvider>
  );
}
