-- ============================================================
-- 047_meetings_and_lead_qualification.sql
-- OPSIYS AI Lead Qualification & Automatic Meeting Booking
-- ============================================================

SET search_path TO public, extensions;

-- 1. SCHEDULING SETTINGS
-- Per-account calendar and booking rules
CREATE TABLE IF NOT EXISTS scheduling_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  meeting_duration_minutes INTEGER NOT NULL DEFAULT 15,
  working_days INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5}', -- 1=Monday, 5=Friday
  working_hours_start TEXT NOT NULL DEFAULT '09:00',
  working_hours_end TEXT NOT NULL DEFAULT '18:00',
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  buffer_before_minutes INTEGER NOT NULL DEFAULT 5,
  buffer_after_minutes INTEGER NOT NULL DEFAULT 10,
  minimum_notice_hours INTEGER NOT NULL DEFAULT 2,
  max_advance_days INTEGER NOT NULL DEFAULT 14,
  google_calendar_enabled BOOLEAN NOT NULL DEFAULT false,
  google_calendar_email TEXT,
  google_calendar_tokens JSONB, -- { access_token, refresh_token, expiry_date, token_type }
  default_meeting_link TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduling_settings_account
  ON scheduling_settings(account_id);

ALTER TABLE scheduling_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scheduling_settings_select ON scheduling_settings;
CREATE POLICY scheduling_settings_select ON scheduling_settings FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS scheduling_settings_insert ON scheduling_settings;
CREATE POLICY scheduling_settings_insert ON scheduling_settings FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS scheduling_settings_update ON scheduling_settings;
CREATE POLICY scheduling_settings_update ON scheduling_settings FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS scheduling_settings_delete ON scheduling_settings;
CREATE POLICY scheduling_settings_delete ON scheduling_settings FOR DELETE
  USING (is_account_member(account_id, 'owner'));

-- 2. MEETINGS
CREATE TABLE IF NOT EXISTS meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  assigned_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  service_requested TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  duration_minutes INTEGER NOT NULL DEFAULT 15,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'rescheduled', 'no_show')),
  meeting_link TEXT,
  booking_source TEXT NOT NULL DEFAULT 'whatsapp_ai'
    CHECK (booking_source IN ('whatsapp_ai', 'manual', 'web_link')),
  calendar_provider TEXT NOT NULL DEFAULT 'native'
    CHECK (calendar_provider IN ('native', 'google_calendar')),
  calendar_event_id TEXT,
  calendar_sync_status TEXT NOT NULL DEFAULT 'local_only'
    CHECK (calendar_sync_status IN ('synced', 'pending', 'failed', 'local_only')),
  lead_summary TEXT,
  cancellation_reason TEXT,
  idempotency_key TEXT UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meetings_account_start_time
  ON meetings(account_id, start_time);
CREATE INDEX IF NOT EXISTS idx_meetings_account_contact
  ON meetings(account_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_meetings_account_status
  ON meetings(account_id, status);
CREATE INDEX IF NOT EXISTS idx_meetings_conversation
  ON meetings(conversation_id);
CREATE INDEX IF NOT EXISTS idx_meetings_idempotency
  ON meetings(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meetings_select ON meetings;
CREATE POLICY meetings_select ON meetings FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS meetings_insert ON meetings;
CREATE POLICY meetings_insert ON meetings FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS meetings_update ON meetings;
CREATE POLICY meetings_update ON meetings FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS meetings_delete ON meetings;
CREATE POLICY meetings_delete ON meetings FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- 3. AI LEAD QUALIFICATION STATE
CREATE TABLE IF NOT EXISTS ai_lead_qualifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'NEW_LEAD'
    CHECK (state IN (
      'NEW_LEAD',
      'GREETING',
      'REQUIREMENT_DISCOVERY',
      'LEAD_QUALIFIED',
      'MEETING_OFFERED',
      'SLOT_SELECTION',
      'MEETING_BOOKED',
      'HUMAN_HANDOFF',
      'FOLLOW_UP_REQUIRED',
      'MEETING_CANCELLED'
    )),
  business_type TEXT,
  requested_service TEXT,
  pain_points TEXT,
  urgency TEXT,
  budget TEXT,
  qualification_notes TEXT,
  proposed_slots JSONB NOT NULL DEFAULT '[]'::jsonb,
  selected_slot TIMESTAMPTZ,
  meeting_id UUID REFERENCES meetings(id) ON DELETE SET NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  last_interaction_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_lead_qualifications_account
  ON ai_lead_qualifications(account_id);
CREATE INDEX IF NOT EXISTS idx_ai_lead_qualifications_contact
  ON ai_lead_qualifications(contact_id);
CREATE INDEX IF NOT EXISTS idx_ai_lead_qualifications_state
  ON ai_lead_qualifications(account_id, state);

ALTER TABLE ai_lead_qualifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_lead_qualifications_select ON ai_lead_qualifications;
CREATE POLICY ai_lead_qualifications_select ON ai_lead_qualifications FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_lead_qualifications_insert ON ai_lead_qualifications;
CREATE POLICY ai_lead_qualifications_insert ON ai_lead_qualifications FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS ai_lead_qualifications_update ON ai_lead_qualifications;
CREATE POLICY ai_lead_qualifications_update ON ai_lead_qualifications FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS ai_lead_qualifications_delete ON ai_lead_qualifications;
CREATE POLICY ai_lead_qualifications_delete ON ai_lead_qualifications FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- 4. CONCURRENCY-SAFE SLOT AVAILABILITY FUNCTION
CREATE OR REPLACE FUNCTION is_slot_available(
  p_account_id UUID,
  p_start_time TIMESTAMPTZ,
  p_end_time TIMESTAMPTZ,
  p_exclude_meeting_id UUID DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM meetings
    WHERE account_id = p_account_id
      AND status IN ('scheduled', 'confirmed', 'rescheduled')
      AND (p_exclude_meeting_id IS NULL OR id <> p_exclude_meeting_id)
      AND start_time < p_end_time
      AND end_time > p_start_time
  );
END;
$$;

-- 5. ATOMIC MEETING BOOKING RPC (Prevents Double-Booking)
CREATE OR REPLACE FUNCTION book_meeting_atomically(
  p_account_id UUID,
  p_contact_id UUID,
  p_conversation_id UUID,
  p_title TEXT,
  p_description TEXT,
  p_service_requested TEXT,
  p_start_time TIMESTAMPTZ,
  p_end_time TIMESTAMPTZ,
  p_timezone TEXT DEFAULT 'Asia/Kolkata',
  p_meeting_link TEXT DEFAULT NULL,
  p_booking_source TEXT DEFAULT 'whatsapp_ai',
  p_lead_summary TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_meeting_id UUID;
  v_existing RECORD;
BEGIN
  -- Idempotency check: replay if previously booked under same key
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, status, start_time, end_time, meeting_link INTO v_existing
    FROM meetings
    WHERE account_id = p_account_id AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'meeting_id', v_existing.id,
        'status', v_existing.status,
        'start_time', v_existing.start_time,
        'end_time', v_existing.end_time,
        'meeting_link', v_existing.meeting_link,
        'is_idempotent_replay', true
      );
    END IF;
  END IF;

  -- Verify availability
  IF NOT is_slot_available(p_account_id, p_start_time, p_end_time) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'SLOT_UNAVAILABLE',
      'message', 'The requested time slot is no longer available. Please select another slot.'
    );
  END IF;

  INSERT INTO meetings (
    account_id,
    contact_id,
    conversation_id,
    title,
    description,
    service_requested,
    start_time,
    end_time,
    timezone,
    duration_minutes,
    status,
    meeting_link,
    booking_source,
    lead_summary,
    idempotency_key
  ) VALUES (
    p_account_id,
    p_contact_id,
    p_conversation_id,
    p_title,
    p_description,
    p_service_requested,
    p_start_time,
    p_end_time,
    COALESCE(p_timezone, 'Asia/Kolkata'),
    GREATEST(1, ROUND(EXTRACT(EPOCH FROM (p_end_time - p_start_time)) / 60)::INTEGER),
    'scheduled',
    p_meeting_link,
    COALESCE(p_booking_source, 'whatsapp_ai'),
    p_lead_summary,
    p_idempotency_key
  ) RETURNING id INTO v_meeting_id;

  -- Update qualification record if conversation exists
  IF p_conversation_id IS NOT NULL THEN
    UPDATE ai_lead_qualifications
    SET state = 'MEETING_BOOKED',
        selected_slot = p_start_time,
        meeting_id = v_meeting_id,
        updated_at = NOW()
    WHERE conversation_id = p_conversation_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'meeting_id', v_meeting_id,
    'status', 'scheduled',
    'start_time', p_start_time,
    'end_time', p_end_time,
    'meeting_link', p_meeting_link
  );
END;
$$;

-- Grant execution privileges
REVOKE ALL ON FUNCTION is_slot_available(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_slot_available(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION book_meeting_atomically(UUID, UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION book_meeting_atomically(UUID, UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
