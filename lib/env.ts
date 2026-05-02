/**
 * Centralised env-var access.
 *
 * Every other module reads env through this file so we get one consistent
 * error if a variable is missing instead of cryptic crashes deep in
 * third-party SDKs. Nothing is hardcoded; nothing is exported as a literal.
 *
 * `validateEnv()` is invoked at the top of every API route and Inngest
 * function so misconfiguration fails loudly the moment a request hits the
 * server, not at some random later code path.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(
      `[env] Missing required environment variable: ${name}. ` +
        `See .env.example for the full list. For local dev set it in ` +
        `.env.local; for production set it in the Vercel dashboard.`,
    );
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

/**
 * Lazy-evaluated env accessors. We never read at module-load time so that
 * Next.js can build pages that don't actually need the secret (e.g. the
 * marketing landing page) without exploding.
 */
export const env = {
  // ─── Slack — three apps, one per agent ──────────────────────────────
  // Each agent IS their own Slack identity. No more chat.write.customize.
  get SLACK_BOT_TOKEN_AWA(): string {
    return required("SLACK_BOT_TOKEN_AWA");
  },
  get SLACK_BOT_TOKEN_KOFI(): string {
    return required("SLACK_BOT_TOKEN_KOFI");
  },
  get SLACK_BOT_TOKEN_RAMA(): string {
    return required("SLACK_BOT_TOKEN_RAMA");
  },
  get SLACK_SIGNING_SECRET_AWA(): string {
    return required("SLACK_SIGNING_SECRET_AWA");
  },
  get SLACK_SIGNING_SECRET_KOFI(): string {
    return required("SLACK_SIGNING_SECRET_KOFI");
  },
  get SLACK_SIGNING_SECRET_RAMA(): string {
    return required("SLACK_SIGNING_SECRET_RAMA");
  },
  get SLACK_APP_ID_AWA(): string {
    return required("SLACK_APP_ID_AWA");
  },
  get SLACK_APP_ID_KOFI(): string {
    return required("SLACK_APP_ID_KOFI");
  },
  get SLACK_APP_ID_RAMA(): string {
    return required("SLACK_APP_ID_RAMA");
  },
  get SLACK_CHANNEL_SOCIAL(): string {
    return required("SLACK_CHANNEL_SOCIAL");
  },
  get SLACK_CHANNEL_GROWTH(): string {
    return required("SLACK_CHANNEL_GROWTH");
  },
  get SLACK_CHANNEL_COO(): string {
    return required("SLACK_CHANNEL_COO");
  },
  /**
   * Optional. The shared inter-agent channel (#tamtam-team).
   * When unset, the team-life Inngest functions log a skip and exit
   * cleanly — existing flows keep working.
   */
  get SLACK_CHANNEL_TEAM(): string | undefined {
    return optional("SLACK_CHANNEL_TEAM");
  },
  /**
   * Optional. Used for: Rama's `dm_georges` tool (open real DM via
   * conversations.open), and the Georges check-in detector (filter
   * which user_id to listen for in #tamtam-team).
   */
  get SLACK_GEORGES_USER_ID(): string | undefined {
    return optional("SLACK_GEORGES_USER_ID");
  },

  // ─── Supabase ───────────────────────────────────────────────────────
  get NEXT_PUBLIC_SUPABASE_URL(): string {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get NEXT_PUBLIC_SUPABASE_ANON_KEY(): string {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get SUPABASE_SERVICE_ROLE_KEY(): string {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get SUPABASE_STORAGE_BUCKET(): string {
    return optional("SUPABASE_STORAGE_BUCKET") ?? "tamtam-social";
  },

  // ─── AI ─────────────────────────────────────────────────────────────
  get ANTHROPIC_API_KEY(): string {
    return required("ANTHROPIC_API_KEY");
  },
  get ANTHROPIC_MODEL(): string {
    return optional("ANTHROPIC_MODEL") ?? "claude-sonnet-4-6";
  },
  get OPENAI_API_KEY(): string {
    return required("OPENAI_API_KEY");
  },
  get OPENAI_IMAGE_MODEL(): string {
    return optional("OPENAI_IMAGE_MODEL") ?? "dall-e-3";
  },

  // ─── Email ──────────────────────────────────────────────────────────
  get RESEND_API_KEY(): string {
    return required("RESEND_API_KEY");
  },
  get RESEND_FROM_EMAIL(): string {
    return required("RESEND_FROM_EMAIL");
  },

  // ─── Job queue ──────────────────────────────────────────────────────
  get INNGEST_EVENT_KEY(): string {
    return required("INNGEST_EVENT_KEY");
  },
  get INNGEST_SIGNING_KEY(): string {
    return required("INNGEST_SIGNING_KEY");
  },

  // ─── LinkedIn ───────────────────────────────────────────────────────
  get LINKEDIN_CLIENT_ID(): string {
    return required("LINKEDIN_CLIENT_ID");
  },
  get LINKEDIN_CLIENT_SECRET(): string {
    return required("LINKEDIN_CLIENT_SECRET");
  },
  get LINKEDIN_PAGE_ID(): string | undefined {
    // Optional — only required once we wire publish_post to the real API.
    return optional("LINKEDIN_PAGE_ID");
  },

  // ─── App ────────────────────────────────────────────────────────────
  get APP_URL(): string {
    return optional("APP_URL") ?? "http://localhost:3000";
  },
  get NODE_ENV(): "development" | "test" | "production" {
    const v = process.env.NODE_ENV;
    if (v === "production" || v === "test") return v;
    return "development";
  },
} as const;

/* -------------------------------------------------------------------------- */
/*  validateEnv()                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The exact set of env vars that MUST be present at request time. Optional
 * vars (ANTHROPIC_MODEL, LINKEDIN_PAGE_ID, etc.) are not in this list.
 *
 * Kept as a plain string array on purpose — it's the contract surface for
 * Vercel deployment configuration and we want it readable without TS.
 */
const REQUIRED_ENV_VARS = [
  // Three Slack apps — one per agent identity
  "SLACK_BOT_TOKEN_AWA",
  "SLACK_BOT_TOKEN_KOFI",
  "SLACK_BOT_TOKEN_RAMA",
  "SLACK_SIGNING_SECRET_AWA",
  "SLACK_SIGNING_SECRET_KOFI",
  "SLACK_SIGNING_SECRET_RAMA",
  "SLACK_APP_ID_AWA",
  "SLACK_APP_ID_KOFI",
  "SLACK_APP_ID_RAMA",
  "SLACK_CHANNEL_SOCIAL",
  "SLACK_CHANNEL_GROWTH",
  "SLACK_CHANNEL_COO",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
  "LINKEDIN_CLIENT_ID",
  "LINKEDIN_CLIENT_SECRET",
] as const;

export type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number];

export class MissingEnvError extends Error {
  readonly missing: readonly string[];
  constructor(missing: readonly string[]) {
    super(
      `Missing required environment variables:\n` +
        missing.map((k) => `  - ${k}`).join("\n") +
        `\nSet them in .env.local for local dev and in the ` +
        `Vercel dashboard for production.`,
    );
    this.name = "MissingEnvError";
    this.missing = missing;
  }
}

/**
 * Throw if any required env var is missing.
 *
 * Call at the top of every API route and Inngest handler. Idempotent and
 * fast (just iterates the constant array), so calling it on every request
 * is fine.
 */
export function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((k) => {
    const v = process.env[k];
    return !v || v.length === 0;
  });
  if (missing.length > 0) {
    throw new MissingEnvError(missing);
  }
}

/**
 * Non-throwing variant for diagnostics endpoints.
 */
export function checkEnv(): { ok: true } | { ok: false; missing: string[] } {
  const missing = REQUIRED_ENV_VARS.filter((k) => {
    const v = process.env[k];
    return !v || v.length === 0;
  });
  return missing.length === 0 ? { ok: true } : { ok: false, missing: [...missing] };
}
