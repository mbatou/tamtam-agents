-- Session 6 — agent_settings table for the ops dashboard.
--
-- Run via the Supabase CLI:
--   supabase db push
-- or paste into Supabase Studio → SQL editor for the project.
-- Idempotent.

CREATE TABLE IF NOT EXISTS agent_settings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent                 text UNIQUE NOT NULL CHECK (agent IN ('social', 'growth', 'coo')),
  focus_this_week       text,
  tone                  text NOT NULL DEFAULT 'warm',
  post_frequency        text NOT NULL DEFAULT '3x_week',
  daily_lead_target     integer NOT NULL DEFAULT 10,
  apollo_monthly_budget integer NOT NULL DEFAULT 75,
  icp_focus             text NOT NULL DEFAULT 'FMCG, Fintech, E-commerce — Senegal only',
  outreach_day4         integer NOT NULL DEFAULT 4,
  outreach_day9         integer NOT NULL DEFAULT 9,
  standup_time          text NOT NULL DEFAULT '08:00',
  brief_frequency       text NOT NULL DEFAULT 'every_4h',
  babacar_reminder      boolean NOT NULL DEFAULT true,
  is_active             boolean NOT NULL DEFAULT true,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- One row per agent. ON CONFLICT keeps re-runs safe.
INSERT INTO agent_settings (agent) VALUES ('social') ON CONFLICT (agent) DO NOTHING;
INSERT INTO agent_settings (agent) VALUES ('growth') ON CONFLICT (agent) DO NOTHING;
INSERT INTO agent_settings (agent) VALUES ('coo')    ON CONFLICT (agent) DO NOTHING;

-- Auto-bump updated_at on UPDATE.
CREATE OR REPLACE FUNCTION agent_settings_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_settings_touch ON agent_settings;
CREATE TRIGGER agent_settings_touch
  BEFORE UPDATE ON agent_settings
  FOR EACH ROW EXECUTE FUNCTION agent_settings_touch_updated_at();
