"use client";

export type DashboardTab = "feed" | "pipeline" | "content" | "settings";

const TABS: ReadonlyArray<{ id: DashboardTab; label: string }> = [
  { id: "feed", label: "Feed" },
  { id: "pipeline", label: "Pipeline" },
  { id: "content", label: "Content" },
  { id: "settings", label: "Settings" },
];

export function TopNav({
  active,
  onChange,
  lastUpdated,
}: {
  active: DashboardTab;
  onChange: (next: DashboardTab) => void;
  lastUpdated: Date | null;
}): JSX.Element {
  return (
    <nav className="sticky top-0 z-30 border-b border-dakar-border bg-dakar-bg/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
        <div className="text-sm font-bold tracking-[0.2em] text-dakar-orange">
          TAMTAM AGENTS
        </div>
        <div className="flex flex-1 items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange(t.id)}
              className={
                "relative px-3 py-1.5 text-sm transition " +
                (active === t.id
                  ? "text-dakar-text"
                  : "text-dakar-muted hover:text-dakar-text")
              }
            >
              {t.label}
              {active === t.id && (
                <span className="absolute -bottom-3 left-0 right-0 h-[2px] bg-dakar-orange" />
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4 text-xs text-dakar-muted">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-dakar-teal" />
            3 agents active
          </span>
          {lastUpdated && (
            <span>
              Last update {lastUpdated.toLocaleTimeString([], { hour12: false })}
            </span>
          )}
          <span className="hidden sm:inline">· refresh 30s</span>
        </div>
      </div>
    </nav>
  );
}
