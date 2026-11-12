-- ============================================================
-- 054_google_calendar_multitenant_saas.sql
-- Multi-Tenant SaaS Google Calendar Integration
-- ============================================================
-- Extends scheduling_settings to store multi-tenant Google Calendar
-- connection status, Google account identifiers (sub/id), and
-- selected calendar IDs per tenant workspace.
-- Re-applies strict column-level SELECT grants so client sessions
-- (authenticated) can never read encrypted tokens, while maintaining
-- safe access to connection metadata.

SET search_path TO public, extensions;

-- 1. Add SaaS multi-tenant columns to scheduling_settings
ALTER TABLE scheduling_settings
  ADD COLUMN IF NOT EXISTS google_calendar_status TEXT NOT NULL DEFAULT 'disconnected',
  ADD COLUMN IF NOT EXISTS google_calendar_account_id TEXT,
  ADD COLUMN IF NOT EXISTS google_calendar_calendar_id TEXT NOT NULL DEFAULT 'primary';

-- Enforce valid connection statuses
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'scheduling_settings_google_calendar_status_check'
  ) THEN
    ALTER TABLE scheduling_settings
      ADD CONSTRAINT scheduling_settings_google_calendar_status_check
      CHECK (google_calendar_status IN ('connected', 'disconnected', 'expired', 'error'));
  END IF;
END $$;

-- 2. Index for Google account lookup and audits
CREATE INDEX IF NOT EXISTS idx_scheduling_settings_google_account
  ON scheduling_settings(google_calendar_account_id)
  WHERE google_calendar_account_id IS NOT NULL;

-- 3. Backfill status for existing rows where google_calendar_enabled is set
UPDATE scheduling_settings
SET google_calendar_status = CASE
  WHEN google_calendar_enabled = true AND google_calendar_tokens IS NOT NULL THEN 'connected'
  ELSE 'disconnected'
END
WHERE google_calendar_status = 'disconnected';

-- 4. Re-enforce Column-Level SELECT Security (RLS Defense-in-Depth)
-- Table-level SELECT on scheduling_settings is revoked from authenticated and anon.
-- Only non-sensitive public columns are granted to authenticated users.
-- google_calendar_tokens remains strictly REVOKED from client roles and accessible
-- exclusively via service_role (supabaseAdmin).
REVOKE SELECT ON scheduling_settings FROM authenticated, anon;

GRANT SELECT (
  id,
  account_id,
  meeting_duration_minutes,
  working_days,
  working_hours_start,
  working_hours_end,
  timezone,
  buffer_before_minutes,
  buffer_after_minutes,
  minimum_notice_hours,
  max_advance_days,
  google_calendar_enabled,
  google_calendar_email,
  google_calendar_status,
  google_calendar_account_id,
  google_calendar_calendar_id,
  default_meeting_link,
  created_at,
  updated_at
) ON scheduling_settings TO authenticated;

