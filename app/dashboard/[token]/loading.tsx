export default function DashboardLoading(): JSX.Element {
  return (
    <div className="min-h-screen bg-dakar-bg p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="h-12 animate-pulse rounded-md border border-dakar-border bg-dakar-surface" />
        <div className="h-24 animate-pulse rounded-md border border-dakar-border bg-dakar-surface" />
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-72 animate-pulse rounded-md border border-dakar-border bg-dakar-surface"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
