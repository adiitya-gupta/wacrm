-- ============================================================
-- 048_atomic_meeting_booking_concurrency.sql
--
-- Concurrency Hardening for Meeting Booking:
-- 1. Adds PostgreSQL btree_gist extension.
-- 2. Creates an EXCLUDE constraint on meetings preventing overlapping
--    time intervals for active meetings within the same account.
-- 3. Updates book_meeting_atomically to acquire an advisory transaction lock
--    and handle exclusion_violation exceptions gracefully.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Clean up any existing constraint if present
ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_no_overlapping_slots;

-- Enforce zero overlapping slots at database level
ALTER TABLE meetings
  ADD CONSTRAINT meetings_no_overlapping_slots
  EXCLUDE USING gist (
    account_id WITH =,
    tstzrange(start_time, end_time) WITH &&
  )
  WHERE (status IN ('scheduled', 'confirmed', 'rescheduled'));

-- Enhanced atomic booking function with serialization and exception catching
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
  -- 1. Transaction-scoped advisory lock serializes concurrent bookings for this account
  -- Prevents race conditions during the is_slot_available check
  PERFORM pg_advisory_xact_lock(hashtext(p_account_id::text));

  -- 2. Idempotency check: replay if previously booked under same key
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

  -- 3. Verify availability
  IF NOT is_slot_available(p_account_id, p_start_time, p_end_time) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'SLOT_UNAVAILABLE',
      'message', 'The requested time slot is no longer available. Please select another slot.'
    );
  END IF;

  -- 4. Insert meeting
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

  -- 5. Update qualification record if conversation exists
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
    'meeting_link', p_meeting_link,
    'is_idempotent_replay', false
  );
EXCEPTION
  WHEN exclusion_violation THEN
    -- Fallback safety net for concurrent double-booking
    RETURN jsonb_build_object(
      'success', false,
      'error', 'SLOT_UNAVAILABLE',
      'message', 'The requested time slot was just booked by another user. Please choose an alternative slot.'
    );
END;
$$;
