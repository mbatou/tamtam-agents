/**
 * Centralised env-var access.
 *
 * Every other module reads env through this file so we get one consistent
 * error if a variable is missing, instead of cryptic crashes deep in
 * third-party SDKs. Nothing is hardcoded; nothing is exported as a literal.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(
      `[env] Missing required environment variable: ${name}. ` +
        `See .env.example for the full list.`,
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
  // Supabase
  get SUPABASE_URL(): string {
    return required("SUPABASE_URL");
  },
  get SUPABASE_ANON_KEY(): string {
    return required("SUPABASE_ANON_KEY");
  },
  get SUPABASE_SERVICE_ROLE_KEY(): string {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get SUPABASE_STORAGE_BUCKET(): string {
    return optional("SUPABASE_STORAGE_BUCKET") ?? "tamtam-social";
  },

  // Anthropic
  get ANTHROPIC_API_KEY(): string {
    return required("ANTHROPIC_API_KEY");
  },
  get ANTHROPIC_MODEL(): string {
    return optional("ANTHROPIC_MODEL") ?? "claude-sonnet-4-20250514";
  },

  // OpenAI
  get OPENAI_API_KEY(): string {
    return required("OPENAI_API_KEY");
  },
  get OPENAI_IMAGE_MODEL(): string {
    return optional("OPENAI_IMAGE_MODEL") ?? "dall-e-3";
  },

  // Slack
  get SLACK_BOT_TOKEN(): string {
    return required("SLACK_BOT_TOKEN");
  },
  get SLACK_SIGNING_SECRET(): string {
    return required("SLACK_SIGNING_SECRET");
  },
  get SLACK_APPROVALS_CHANNEL(): string {
    return required("SLACK_APPROVALS_CHANNEL");
  },
  get SLACK_COO_CHANNEL(): string {
    return required("SLACK_COO_CHANNEL");
  },
  get SLACK_GEORGES_USER_ID(): string {
    return required("SLACK_GEORGES_USER_ID");
  },

  // Resend
  get RESEND_API_KEY(): string {
    return required("RESEND_API_KEY");
  },
  get RESEND_FROM_EMAIL(): string {
    return required("RESEND_FROM_EMAIL");
  },

  // Inngest
  get INNGEST_EVENT_KEY(): string | undefined {
    return optional("INNGEST_EVENT_KEY");
  },
  get INNGEST_SIGNING_KEY(): string | undefined {
    return optional("INNGEST_SIGNING_KEY");
  },

  // App
  get APP_URL(): string {
    return optional("APP_URL") ?? "http://localhost:3000";
  },
  get NODE_ENV(): "development" | "test" | "production" {
    const v = process.env.NODE_ENV;
    if (v === "production" || v === "test") return v;
    return "development";
  },
} as const;
