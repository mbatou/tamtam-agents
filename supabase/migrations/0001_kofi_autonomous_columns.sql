-- Session 5B — Kofi autonomous prospecting columns.
--
-- Run via the Supabase CLI:
--   supabase db push
-- or paste into Supabase Studio → SQL editor for the project.
-- Idempotent: every column uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS contact_title text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS intent_signal text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS confidence_score integer;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS awa_warmup boolean DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS outreach_channel text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS why_now text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS linkedin_url text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS linkedin_message_id text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS day4_sent_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS day9_sent_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS response_classification text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS escalated_to_georges boolean DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS escalated_at timestamptz;

-- Soft constraint on response_classification (NULL stays valid).
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_response_classification_check;
ALTER TABLE leads ADD CONSTRAINT leads_response_classification_check
  CHECK (
    response_classification IS NULL OR
    response_classification IN ('positive', 'neutral', 'negative', 'referral')
  );

-- Soft constraint on outreach_channel.
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_outreach_channel_check;
ALTER TABLE leads ADD CONSTRAINT leads_outreach_channel_check
  CHECK (
    outreach_channel IS NULL OR
    outreach_channel IN ('linkedin', 'email', 'both')
  );

-- Helpful indexes for the day-4 / day-9 cadence queries Kofi runs
-- every morning. Skip if your row count is small.
CREATE INDEX IF NOT EXISTS idx_leads_status_last_contact
  ON leads (status, last_contact_at)
  WHERE status = 'contacted';

CREATE INDEX IF NOT EXISTS idx_leads_email_lower
  ON leads (lower(email))
  WHERE email IS NOT NULL;
