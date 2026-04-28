export default function HomePage(): JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">
        Tamtam Agents
      </h1>
      <p className="text-lg text-white/80">
        AI multi-agent system for Tamtam — Lupandu SARL&apos;s WhatsApp
        Status influencer marketing platform, operated from Dakar.
      </p>
      <ul className="space-y-2 text-white/70">
        <li>
          <span className="text-tamtam-accent">@tamtam-social</span> —
          generates and publishes LinkedIn content
        </li>
        <li>
          <span className="text-tamtam-accent">@tamtam-growth</span> —
          researches leads and runs outreach
        </li>
        <li>
          <span className="text-tamtam-accent">@tamtam-coo</span> —
          orchestrates, monitors, and reports
        </li>
      </ul>
      <p className="text-sm text-white/50">
        This UI is the operational shell; agents run via Inngest jobs and
        Slack interactions.
      </p>
    </main>
  );
}
