# Tamtam Agents

AI-powered multi-agent system for **Tamtam** — a WhatsApp Status micro-influencer
marketing platform based in Dakar, Senegal, owned by **Lupandu SARL**.

> **Status:** live on Vercel. Slack webhooks registered. Inngest synced.

## The team

- **Awa** — `@tamtam-social` — creative voice; generates and publishes LinkedIn content
- **Kofi** — `@tamtam-growth` — sharp prospector; researches leads and runs outreach
- **Rama** — `@tamtam-coo` — calm operator; orchestrates, monitors, reports

All three operate as Slack teammates inside the **Lupandu SAS** workspace.
The only human in the loop is **Georges**, who approves consequential actions.

The team also lives together in **#tamtam-team** — morning standups
from Rama, inter-agent reactions when a post ships or a lead lands,
random "human moments" sprinkled through the week, and a Friday
wrap-up. Georges can drop in, say hello, and get a real response.

## Stack

Next.js 14 · TypeScript · Supabase · Inngest · Slack Bolt · Anthropic Claude ·
OpenAI DALL-E 3 · Resend · React Email · Tailwind · Vercel

## Branches

- `main` — production (deployed to Vercel)
- `dev`  — active development (preview deploys on every push)

## Triggering an agent

### From Slack (the normal path)

```text
@tamtam-social create a LinkedIn post about <topic>
@tamtam-growth  research <company> and draft outreach
@tamtam-coo     what is the team status right now
```

The bot must be invited to `#tamtam-social`, `#tamtam-growth`, and
`#tamtam-coo`. Approval messages land in the agent's own channel; the
COO daily brief lands in `#tamtam-coo`.

### Manually via HTTPS

Each agent exposes a manual-trigger endpoint that emits the same
Inngest event a Slack mention would. Useful for cron alternatives
or admin tooling.

```bash
curl -X POST https://<your-vercel-url>/api/agents/social \
  -H "Content-Type: application/json" \
  -d '{"brief": "post about why WhatsApp Status beats Instagram in West Africa"}'

curl -X POST https://<your-vercel-url>/api/agents/growth \
  -H "Content-Type: application/json" \
  -d '{"lead_id": "<uuid>"}'

curl -X POST https://<your-vercel-url>/api/agents/coo \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Via the signed-event script (no Slack needed)

`scripts/send-test-event.ts` signs a fake Slack `app_mention` payload
with your real `SLACK_SIGNING_SECRET` and POSTs it to `/api/slack/events`.
Drives the full pipeline without typing in Slack.

```bash
npm run test:event -- social "create a post about Tamtam"
npm run test:event -- growth "research Sunugal e-commerce in Dakar"
npm run test:event -- coo    "summarise the last 24h"
```

Reads `APP_URL` (defaults to `http://localhost:3000`) and the Slack
channel ids from env. Pull env locally first with `vercel env pull`.

## Health endpoint

```bash
curl https://<your-vercel-url>/api/health
```

Returns 200 when Supabase, Slack, Inngest, and the env contract all
pass; 503 otherwise. Safe to point an uptime monitor at.

## Dashboards

| Service | Dashboard |
|---|---|
| Vercel | https://vercel.com/dashboard → tamtam-agents |
| Supabase | https://supabase.com/dashboard |
| Inngest | https://app.inngest.com |
| Slack app | https://api.slack.com/apps |
| Resend | https://resend.com/emails |
| Anthropic | https://console.anthropic.com |
| OpenAI | https://platform.openai.com |

## Environment Setup

### Production (Vercel)

Vercel's dashboard is the source of truth for secrets:

> Project Settings → Environment Variables → add each key from
> `.env.example` for **Production**, **Preview**, and **Development**.

Webhook URLs (paste *after* the first deploy gives you a stable URL):

- Slack → Event Subscriptions → Request URL: `https://<vercel-url>/api/slack/events`
- Slack → Interactivity & Shortcuts → Request URL: `https://<vercel-url>/api/slack/interactions`
- Inngest → Apps → Sync app → URL: `https://<vercel-url>/api/inngest`

### Slack subscriptions for #tamtam-team

For the Georges check-in detector to receive plain messages (not just
`@`-mentions), the Slack app must be subscribed to additional events:

- Slack app → **Event Subscriptions** → **Subscribe to bot events**
  → add `message.channels`
- Slack app → **OAuth & Permissions** → bot scopes → ensure
  `channels:history` is present (it usually is for `app_mention` apps,
  but double-check after adding `message.channels`)
- Reinstall the app to the workspace if Slack prompts for it
- Invite the bot to `#tamtam-team` (`/invite @<bot-name>`)

Without these the detector silently no-ops — `@`-mentions and existing
flows keep working.

### Local development (when you actually need it)

This is a webhook-heavy app — Slack can't reach `localhost` without an
ngrok tunnel, so most iteration happens via preview deploys. Local dev
is useful only for running scripts or iterating on agent prompts.

```bash
npm i -g vercel
vercel link                        # one-time, links to the Vercel project
vercel env pull .env.local --yes  # pull all dev-scoped vars
npm run dev                        # next dev on :3000
# when done:
rm .env.local                      # keep disk clean
```

`.env.local` is gitignored (along with `.env`, `.env*.local`) and can
never be committed.

### Validation at runtime

`lib/env.ts` exports `validateEnv()` (and a non-throwing `checkEnv()`),
called at the top of every API route. Misconfiguration returns a 500
listing exactly which keys are missing (`MissingEnvError`). The required
list is the const `REQUIRED_ENV_VARS`. Optional variables
(`ANTHROPIC_MODEL`, `LINKEDIN_PAGE_ID`, `SUPABASE_STORAGE_BUCKET`,
`SLACK_GEORGES_USER_ID`) are not in that list and have sensible
defaults or graceful fallbacks.

### Generating Supabase types

`types/database.ts` is hand-written to match `supabase gen types
typescript` output. To regenerate from a real Supabase project:

```bash
# Option A: pull-gen-delete
vercel env pull .env.local --yes && \
  npx supabase gen types typescript \
    --project-id "$(node -e "console.log(process.env.NEXT_PUBLIC_SUPABASE_URL.split('.')[0].split('//')[1])")" \
    > types/database.ts && \
  rm .env.local

# Option B: pass the project ref directly
npx supabase gen types typescript --project-id <ref> > types/database.ts
```

If the generated file differs from the hand-written one, commit on `dev`.
