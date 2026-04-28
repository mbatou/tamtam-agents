# Tamtam Agents

AI-powered multi-agent system for **Tamtam** — a WhatsApp Status micro-influencer
marketing platform based in Dakar, Senegal, owned by **Lupandu SARL**.

## Agents

- **@tamtam-social** — generates and publishes LinkedIn content
- **@tamtam-growth** — researches leads and runs outreach
- **@tamtam-coo** — orchestrates, monitors, and reports

All three operate as Slack teammates inside the **Lupandu SAS** workspace.
The only human in the loop is **Georges**, who approves consequential actions.

## Stack

Next.js 14 · TypeScript · Supabase · Inngest · Slack Bolt · Anthropic Claude ·
OpenAI DALL-E 3 · Resend · React Email · Tailwind · Vercel

## Branches

- `main` — protected, release-ready
- `dev`  — active development

See `CLAUDE.md` (forthcoming) for build sessions and architecture notes.

## Environment Setup

### Local development

1. Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
2. Fill in real values for every key in `.env.local`. Some come from
   third-party dashboards (Slack, Supabase, Anthropic, OpenAI, Resend,
   Inngest, LinkedIn) — see each section header in `.env.example`.
3. **Never commit `.env.local`.** It is in `.gitignore` (along with
   `.env`, `.env.local`, and `.env*.local`). If you ever see one of
   these tracked, treat it as a credential leak and rotate the keys.

### Production (Vercel)

Set every variable from `.env.example` in the Vercel dashboard:

> Settings → Environment Variables → add each key for `Production`
> (and `Preview` if you want preview deployments to be live).

Do **not** ship a `.env` or `.env.local` to Vercel — Vercel reads its
own dashboard values, not files in the repo.

### Validation at runtime

`lib/env.ts` exports `validateEnv()`, which is called at the top of
every API route and Inngest function. If any required variable is
missing, the request fails fast with a 500 listing exactly which keys
are absent (see `MissingEnvError`). Misconfiguration surfaces on the
first request rather than at some arbitrary later code path.

The full required list is the const `REQUIRED_ENV_VARS` in
`lib/env.ts`. Optional variables (e.g. `ANTHROPIC_MODEL`,
`LINKEDIN_PAGE_ID`, `SUPABASE_STORAGE_BUCKET`) are not in that list
and have sensible defaults.

### Generating Supabase types

`types/database.ts` is hand-written to match `supabase gen types
typescript` output. Once the Supabase project is provisioned and
the CLI is authenticated, regenerate it:

```bash
npx supabase gen types typescript \
  --project-id <project-ref> > types/database.ts
```

The hand-written file becomes a drop-in replacement target.
