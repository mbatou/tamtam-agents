# Tamtam Agents

AI-powered multi-agent system for **Tamtam** — a WhatsApp Status micro-influencer
marketing platform based in Dakar, Senegal, owned by **Lupandu SARL**.

> **Status:** live on Vercel. Slack webhooks registered. Inngest synced.

## The team

- **Awa Diallo** — Social Media Lead, posts as her own Slack identity in `#tamtam-social`
- **Kofi Mensah** — Growth & Sales Lead, posts as his own Slack identity in `#tamtam-growth`
- **Rama Sall** — COO, posts as her own Slack identity in `#tamtam-coo`

Each agent is a **separate Slack app** with its own bot token, signing
secret, app id, and Slack user. There are no `chat.write.customize`
persona overrides anywhere — when Awa speaks it is literally Awa's
app posting through Awa's token.

The only human in the loop is **Georges DIEME** (founder, CTO), who
approves consequential actions. The team also lives together in
**#tamtam-team** — morning standups from Rama, inter-agent reactions
when a post ships or a lead lands, random "human moments" sprinkled
through the week, a Friday wrap-up, and onboarding messages when
someone new joins. Georges can drop in, say hello, get a real
response.

### Human-behavior layer

`lib/human-behavior.ts` gives each agent a working schedule (WAT):

| Agent | Hours | Workdays | Lunch | Late-night reply |
|---|---|---|---|---|
| Awa   | 09:00–18:00 | Mon–Fri | 13–14 | never |
| Kofi  | 08:00–19:00 | Mon–Sat | 13–14 | 15% chance |
| Rama  | 07:00–19:00 | Mon–Fri | 13–14 | never |

Outside hours, the agent posts a human auto-reply ("I'll pick this
up in the morning charle") and stops. Within hours, a 2–15-minute
"thinking" delay (`step.sleep`) runs before the reply lands.

A status-rotation cron updates each agent's Slack profile status
every 30 minutes on weekdays — `🎨 Creating content`, `🍽️ Back at
2pm`, `✅ Done for today`, etc.

Cron-driven jobs (Rama's standup, daily brief, Friday wrap-up)
bypass the gate — Rama sets her own schedule.

## Stack

Next.js 14 · TypeScript · Supabase · Inngest · Slack Bolt · Anthropic Claude ·
OpenAI DALL-E 3 · Resend · React Email · Tailwind · Vercel

## Branches

- `main` — production (deployed to Vercel)
- `dev`  — active development (preview deploys on every push)

## Triggering an agent

### From Slack (the normal path)

```text
@Awa create a LinkedIn post about <topic>          (in #tamtam-social)
@Kofi research <company> and draft outreach         (in #tamtam-growth)
@Rama what is the team status right now             (in #tamtam-coo)
```

Each agent must be invited to their channel + `#tamtam-team`.
Routing is by channel id, not by mention text — typing `@Awa` in
`#tamtam-coo` will not route to Awa.

In `#tamtam-team`, Georges can also use ops commands (anyone in the
channel can, but it's mostly for him):

```text
trigger standup     → Rama posts the morning standup right now
trigger wrapup      → Rama posts the Friday retro right now
trigger moment      → A random agent fires a human moment
trigger reactions   → Smoke-test all 4 inter-agent reactions
```

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

### Slack apps — required scopes & event subscriptions

We run **three** Slack apps (Awa / Kofi / Rama). Each one needs
identical configuration:

**Bot scopes** (`OAuth & Permissions → Bot Token Scopes`):

```
chat:write
chat:write.public
app_mentions:read
channels:history       ← also needed by Kofi's thread-continuity flow
                          (conversations.replies on public channels)
im:write
im:history
users.profile:write    ← needed for status rotation + avatar script
users:read
```

If `#tamtam-growth` is a **private** channel instead of public,
also add `groups:history` to the Kofi app — `conversations.replies`
needs the per-channel-type scope.

**Event subscriptions** (`Event Subscriptions → Subscribe to bot
events`):

```
app_mention
message.channels
member_joined_channel
```

**Request URLs** (same on all three apps — multi-app signature
verification picks the right secret per request):

- Event Subscriptions Request URL: `https://<vercel-url>/api/slack/events`
- Interactivity & Shortcuts Request URL: `https://<vercel-url>/api/slack/interactions`

Reinstall each app to the workspace after scope or event changes.
Invite each agent's user to all four channels (`#tamtam-social`,
`#tamtam-growth`, `#tamtam-coo`, `#tamtam-team`).

### Avatar setup

Run once after the apps are installed and tokens are on disk:

```bash
vercel env pull .env.local --yes
npm run set-avatars
rm .env.local
```

Sets each agent's profile photo to a colored initials avatar
(Awa = orange #D35400, Kofi = green #2D6A4F, Rama = slate #4A4E69).
Re-runnable — Slack overwrites the existing photo.

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

### Private ops dashboard (Session 6)

Mission-control UI at `/dashboard/[DASHBOARD_SECRET]`. No login,
no session — the URL itself is the credential. On mismatch (or
when the secret is unset), the page returns a real 404 and the
eight `/api/dashboard/*` routes do the same.

**Generate the secret:**

```bash
openssl rand -hex 32
```

Set `DASHBOARD_SECRET` on Vercel (Production / Preview / Development).
Visit `https://<your-vercel-url>/dashboard/<secret>` to access.

**Sections:**

- **Feed** — last 100 `agent_logs` rows with per-agent filter,
  expandable metadata, 30-second auto-refresh, "● Live" indicator.
- **Pipeline** — leads table with stats bar (counts + Apollo credits),
  inline status dropdowns, status / source / search filters,
  "+ Add lead" modal, hover-reveal pause/delete actions.
- **Content** — scheduled vs published tabs with approve / reject
  / view actions; image-prompt and caption preview modal.
- **Settings** — three agent cards (Awa / Kofi / Rama) with
  editable focus, tone, frequency, lead target, Apollo budget,
  ICP, follow-up cadence, standup time, brief frequency, Babacar
  reminder toggle. Each card has trigger buttons that fire the
  matching Inngest event with id-dedup.

**Trigger map** (`/api/dashboard/trigger`):

| Action | Fires |
|---|---|
| `growth + prospecting` | `tamtam/kofi.prospecting` |
| `coo + standup`        | `tamtam/team.standup` |
| `coo + brief`          | `tamtam/coo.tick` (cron-mirror, no fake Slack context) |
| `coo + wrapup`         | `tamtam/team.friday-wrapup` |
| `social + post`        | `tamtam/social.run` (cron-mirror, no fake Slack context) |

**Security caveats** (read before sharing the URL):

- The token travels in URL paths and query strings → it lands in
  Vercel access logs, browser history, referrer headers (when
  navigating away to external links), screenshots. Treat as a
  credential. Rotate on suspicion of leak.
- Routes use timing-safe HMAC-style comparison (`crypto.timingSafeEqual`)
  to prevent token enumeration via response-time analysis.
- All 404s are real 404s — the page's existence isn't leaked.
- Lead PATCH whitelists the patchable fields (no writes to
  `confidence_score`, `escalated_to_georges`, etc. via the
  dashboard).

### Database migrations

`supabase/migrations/` holds idempotent SQL migrations that extend
the schema beyond what was first provisioned. Run them in order via
the Supabase CLI:

```bash
supabase db push
```

Or paste the SQL into Supabase Studio → SQL Editor for the project.
All migrations use `ADD COLUMN IF NOT EXISTS` and similar guards, so
re-running is safe.

Current migrations:

- `0001_kofi_autonomous_columns.sql` — adds the columns Session 5B
  introduced for Kofi's autonomous prospecting (intent signal,
  confidence score, follow-up timestamps, response classification,
  escalation flag, etc.) plus the indexes the day-4/day-9 cadence
  queries depend on.
- `0002_email_messages.sql` — Session 5C outbound-email audit
  table + extends `leads.status` to include `hot/converted/paused`.
- `0003_agent_settings.sql` — Session 6 dashboard settings table
  (one row per agent, default rows seeded). Auto-bumps
  `updated_at` via trigger on every UPDATE.

### Pipeline admin from Slack (Session 5C)

Georges manages the lead pipeline by talking to Kofi in
`#tamtam-growth`. Kofi understands these patterns natively (they
route through `update_lead_status_by_company`, `add_manual_lead`,
`pause_lead`, `get_pipeline_summary`):

```
@Kofi Wave Sénégal replied, they're interested
   → status = warm, classification = positive

@Kofi mark Jumia as dead, wrong contact
   → status = rejected, note appended

@Kofi pause outreach to Orange Sénégal
   → status = paused

@Kofi add this lead: Amadou Diallo, marketing@dakarfood.sn, Dakar Food
   → row created, status = researched, picked up tomorrow

@Kofi what's the pipeline status?
   → snapshot: Hot / Warm / Contacted / Paused / Cold / Converted
                + Apollo credits this month
```

Kofi acts immediately and confirms in one short reply. He does NOT
ask permission — Georges is giving instructions, not asking.

### Apollo.io credit budget

Apollo's free tier is **75 credits/month**. `lib/apollo.ts` enforces
a soft cap of **70** (5-credit safety buffer):

- `kofi-daily-prospecting` enriches up to **3 high-confidence leads**
  per run (score ≥ 70). Roughly 3 credits/day × 22 working days =
  ~66 credits/month — within budget.
- When credits remaining drops below 5, the entire enrichment step
  is skipped for the day and Kofi posts a warning in
  `#tamtam-growth`. Day-1 emails go only to leads Apollo has
  already verified — no enrichment, no send.
- Every credit-consuming call writes `apollo.credit_used` to
  `agent_logs`. The morning brief surfaces the running monthly
  count.

If a higher tier is ever needed, swap `APOLLO_MONTHLY_HARD_CEILING`
in `lib/apollo.ts` to match the new allowance.

### Kofi autonomous prospecting (Session 5B + 5C)

Kofi runs a full prospecting day at **08:00 WAT, Mon–Sat** without
asking permission. Cron-driven `kofi-daily-prospecting`:

1. snapshots Awa's last 7 days of content (warmth signal),
2. researches **10 Senegalese leads** via Claude (Gojiberry intent
   framework — Awa-warmed → buying-signals → cold ICP),
3. sends LinkedIn connection requests (graceful fallback: "queued
   for manual send" until LinkedIn messaging API approval lands),
4. sends email-1 via Resend (3-sentence curiosity message, no
   pitch, no link, no Tamtam name unless they already know us),
5. fires day-4 follow-ups (with Tiak-Tiak proof) and day-9
   soft-closes from the cadence,
6. marks leads cold after 9 days of silence,
7. posts the morning brief to `#tamtam-growth` in his voice.

Reply detection runs through `/api/webhooks/email-reply`. Wire
whichever inbound product you choose (Resend Inbound, SendGrid
Inbound Parse, Mailgun…) to POST to that URL with HMAC-SHA256 of
the raw body in `X-Webhook-Signature`, signed with
`RESEND_WEBHOOK_SECRET`. The classifier (`kofi-email-replied`) then:

- 'positive' → DMs Georges with the full context template, marks
  the lead `warm` and `escalated_to_georges = true`
- 'neutral'  → leaves status `contacted`, cadence continues
- 'negative' → status `rejected`, no further outreach
- 'referral' → logged on the existing lead for follow-up

LinkedIn replies depend on partnership-tier API access (Sales
Navigator API / Talent Solutions). Until that lands, the
`kofi-response-monitor` cron runs cleanly but finds nothing on
the LinkedIn side. Email reply detection is unaffected.

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
