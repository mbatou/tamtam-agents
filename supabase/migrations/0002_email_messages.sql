-- Session 5C — outbound email message tracking.
--
-- Run via the Supabase CLI:
--   supabase db push
-- or paste into Supabase Studio → SQL editor for the project.
-- Idempotent: every column uses ADD COLUMN IF NOT EXISTS / IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS email_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       uuid REFERENCES leads(id) ON DELETE SET NULL,
  direction     text NOT NULL CHECK (direction IN ('outbound')),
  subject       text NOT NULL,
  body          text NOT NULL,
  resend_message_id text,
  email_type    text NOT NULL CHECK (email_type IN ('day1', 'day4', 'day9', 'manual')),
  sent_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_messages_lead_id
  ON email_messages (lead_id);

CREATE INDEX IF NOT EXISTS idx_email_messages_resend_message_id
  ON email_messages (resend_message_id)
  WHERE resend_message_id IS NOT NULL;

-- Extend the leads.status CHECK constraint (if any) for the new
-- statuses Kofi can hold: 'hot', 'converted', 'paused'. We use
-- a soft (CHECK) constraint replacement that's idempotent.
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_status_check
  CHECK (
    status IN (
      'new', 'researching', 'researched', 'queued', 'contacted',
      'warm', 'hot', 'replied', 'cold', 'rejected', 'paused',
      'converted', 'won', 'lost', 'do_not_contact'
    )
  );
