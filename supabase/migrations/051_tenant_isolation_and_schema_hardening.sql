-- ============================================================
-- 051_tenant_isolation_and_schema_hardening.sql
--
-- Wattomation Multi-Tenant Isolation & Schema Hardening
--
-- 1. Drops idx_accounts_one_per_owner to allow multi-tenant provisioning
--    by platform administrators, replacing with non-unique idx_accounts_owner_user_id.
-- 2. Updates redeem_invitation RPC to atomically transfer accounts.owner_user_id
--    when an invitation with role 'owner' is redeemed.
-- 3. Adds direct account_id column, foreign keys, and composite indexes to
--    messages and broadcast_recipients with safe parent backfill.
-- 4. Updates RLS policies on messages and broadcast_recipients to use direct
--    is_account_member(account_id) checks for high-performance tenant isolation.
-- 5. Revokes client-side SELECT on scheduling_settings.google_calendar_tokens
--    to prevent raw OAuth token exposure to browser clients.
-- ============================================================

SET search_path TO public, extensions;

-- ============================================================
-- 1. Relax accounts.owner_user_id unique index
-- ============================================================
DROP INDEX IF EXISTS idx_accounts_one_per_owner;
CREATE INDEX IF NOT EXISTS idx_accounts_owner_user_id ON accounts(owner_user_id);

-- ============================================================
-- 2. Update redeem_invitation RPC to transfer owner_user_id
-- ============================================================
CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  -- Caller's current account + its owner.
  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id;

  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  -- Edge case: already a member
  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  -- Safety: the caller must be the owner of their current personal account
  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  -- Refuse if caller's personal account already has domain data
  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  -- Move the profile to the joined account
  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  -- If invited as owner, transfer account ownership
  IF v_inv.role = 'owner' THEN
    UPDATE accounts
    SET owner_user_id = v_caller_id,
        updated_at = NOW()
    WHERE id = v_inv.account_id;
  END IF;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  -- Clean up the orphan personal account
  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;

-- ============================================================
-- 3. Add direct account_id to messages and broadcast_recipients
-- ============================================================
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;

-- Backfill messages.account_id from parent conversations
UPDATE messages m
SET account_id = c.account_id
FROM conversations c
WHERE m.conversation_id = c.id
  AND m.account_id IS NULL;

-- Backfill broadcast_recipients.account_id from parent broadcasts
UPDATE broadcast_recipients br
SET account_id = b.account_id
FROM broadcasts b
WHERE br.broadcast_id = b.id
  AND br.account_id IS NULL;

-- Composite indexes for high-volume isolation & lookup
CREATE INDEX IF NOT EXISTS idx_messages_account_created
  ON messages(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_account_wamid
  ON messages(account_id, message_id)
  WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_account
  ON broadcast_recipients(account_id);

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_account_wamid
  ON broadcast_recipients(account_id, whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

-- Triggers to guarantee account_id is populated from parent on insert if omitted,
-- and prevent child records from being assigned to a mismatched tenant account.
CREATE OR REPLACE FUNCTION set_message_account_id()
RETURNS TRIGGER AS $$
DECLARE
  v_parent_account_id UUID;
BEGIN
  IF NEW.conversation_id IS NOT NULL THEN
    SELECT account_id INTO v_parent_account_id FROM conversations WHERE id = NEW.conversation_id;
    IF NEW.account_id IS NULL THEN
      NEW.account_id := v_parent_account_id;
    ELSIF v_parent_account_id IS NOT NULL AND NEW.account_id <> v_parent_account_id THEN
      RAISE EXCEPTION 'Mismatched account_id (%) for conversation (%) belonging to account (%)',
        NEW.account_id, NEW.conversation_id, v_parent_account_id
        USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_message_account_id ON messages;
CREATE TRIGGER trg_set_message_account_id
BEFORE INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION set_message_account_id();

CREATE OR REPLACE FUNCTION set_broadcast_recipient_account_id()
RETURNS TRIGGER AS $$
DECLARE
  v_parent_account_id UUID;
BEGIN
  IF NEW.broadcast_id IS NOT NULL THEN
    SELECT account_id INTO v_parent_account_id FROM broadcasts WHERE id = NEW.broadcast_id;
    IF NEW.account_id IS NULL THEN
      NEW.account_id := v_parent_account_id;
    ELSIF v_parent_account_id IS NOT NULL AND NEW.account_id <> v_parent_account_id THEN
      RAISE EXCEPTION 'Mismatched account_id (%) for broadcast (%) belonging to account (%)',
        NEW.account_id, NEW.broadcast_id, v_parent_account_id
        USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_broadcast_recipient_account_id ON broadcast_recipients;
CREATE TRIGGER trg_set_broadcast_recipient_account_id
BEFORE INSERT ON broadcast_recipients
FOR EACH ROW
EXECUTE FUNCTION set_broadcast_recipient_account_id();

-- ============================================================
-- 4. Update RLS policies to use direct account_id
-- ============================================================
DROP POLICY IF EXISTS messages_select ON messages;
CREATE POLICY messages_select ON messages FOR SELECT
  USING (
    account_id IS NOT NULL AND is_account_member(account_id)
    OR (
      account_id IS NULL AND EXISTS (
        SELECT 1 FROM conversations c
        WHERE c.id = messages.conversation_id AND is_account_member(c.account_id)
      )
    )
  );

DROP POLICY IF EXISTS messages_modify ON messages;
CREATE POLICY messages_modify ON messages FOR ALL
  USING (
    account_id IS NOT NULL AND is_account_member(account_id, 'agent')
    OR (
      account_id IS NULL AND EXISTS (
        SELECT 1 FROM conversations c
        WHERE c.id = messages.conversation_id AND is_account_member(c.account_id, 'agent')
      )
    )
  )
  WITH CHECK (
    account_id IS NOT NULL AND is_account_member(account_id, 'agent')
    OR (
      account_id IS NULL AND EXISTS (
        SELECT 1 FROM conversations c
        WHERE c.id = messages.conversation_id AND is_account_member(c.account_id, 'agent')
      )
    )
  );

DROP POLICY IF EXISTS broadcast_recipients_select ON broadcast_recipients;
CREATE POLICY broadcast_recipients_select ON broadcast_recipients FOR SELECT
  USING (
    account_id IS NOT NULL AND is_account_member(account_id)
    OR (
      account_id IS NULL AND EXISTS (
        SELECT 1 FROM broadcasts b
        WHERE b.id = broadcast_recipients.broadcast_id AND is_account_member(b.account_id)
      )
    )
  );

DROP POLICY IF EXISTS broadcast_recipients_modify ON broadcast_recipients;
CREATE POLICY broadcast_recipients_modify ON broadcast_recipients FOR ALL
  USING (
    account_id IS NOT NULL AND is_account_member(account_id, 'agent')
    OR (
      account_id IS NULL AND EXISTS (
        SELECT 1 FROM broadcasts b
        WHERE b.id = broadcast_recipients.broadcast_id AND is_account_member(b.account_id, 'agent')
      )
    )
  )
  WITH CHECK (
    account_id IS NOT NULL AND is_account_member(account_id, 'agent')
    OR (
      account_id IS NULL AND EXISTS (
        SELECT 1 FROM broadcasts b
        WHERE b.id = broadcast_recipients.broadcast_id AND is_account_member(b.account_id, 'agent')
      )
    )
  );

-- ============================================================
-- 5. Revoke client SELECT on sensitive tokens in scheduling_settings
-- ============================================================
-- In PostgreSQL, REVOKE SELECT (col) is bypassed if table-level SELECT exists.
-- We revoke table-level SELECT and grant SELECT only on safe non-secret columns.
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
  default_meeting_link,
  created_at,
  updated_at
) ON scheduling_settings TO authenticated;
