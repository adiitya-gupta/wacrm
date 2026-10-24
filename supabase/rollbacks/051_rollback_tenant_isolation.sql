-- ============================================================
-- 051_rollback_tenant_isolation.sql
--
-- Rollback plan for migration 051.
-- Location: supabase/rollbacks/ (NOT in supabase/migrations/ to prevent
-- accidental execution by migration runners).
-- ============================================================

SET search_path TO public, extensions;

-- 1. Restore scheduling_settings table-level SELECT grant
GRANT SELECT ON scheduling_settings TO authenticated;

-- 2. Restore legacy RLS policies on messages
DROP POLICY IF EXISTS messages_select ON messages;
CREATE POLICY messages_select ON messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id AND is_account_member(c.account_id))
);

DROP POLICY IF EXISTS messages_modify ON messages;
CREATE POLICY messages_modify ON messages FOR ALL USING (
  EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id AND is_account_member(c.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id AND is_account_member(c.account_id, 'agent'))
);

-- 3. Restore legacy RLS policies on broadcast_recipients
DROP POLICY IF EXISTS broadcast_recipients_select ON broadcast_recipients;
CREATE POLICY broadcast_recipients_select ON broadcast_recipients FOR SELECT USING (
  EXISTS (SELECT 1 FROM broadcasts b WHERE b.id = broadcast_recipients.broadcast_id AND is_account_member(b.account_id))
);

DROP POLICY IF EXISTS broadcast_recipients_modify ON broadcast_recipients;
CREATE POLICY broadcast_recipients_modify ON broadcast_recipients FOR ALL USING (
  EXISTS (SELECT 1 FROM broadcasts b WHERE b.id = broadcast_recipients.broadcast_id AND is_account_member(b.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM broadcasts b WHERE b.id = broadcast_recipients.broadcast_id AND is_account_member(b.account_id, 'agent'))
);

-- 4. Drop added composite indexes and triggers
DROP TRIGGER IF EXISTS trg_set_message_account_id ON messages;
DROP FUNCTION IF EXISTS set_message_account_id();
DROP TRIGGER IF EXISTS trg_set_broadcast_recipient_account_id ON broadcast_recipients;
DROP FUNCTION IF EXISTS set_broadcast_recipient_account_id();

DROP INDEX IF EXISTS idx_messages_account_created;
DROP INDEX IF EXISTS idx_messages_account_wamid;
DROP INDEX IF EXISTS idx_broadcast_recipients_account;
DROP INDEX IF EXISTS idx_broadcast_recipients_account_wamid;

-- 5. Restore accounts.owner_user_id unique index safely
-- If multi-workspace accounts were created post-migration 051, a naive unique index
-- would fail and abort. We check for duplicates first.
DO $$
DECLARE
  v_dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_dup_count
  FROM (
    SELECT owner_user_id
    FROM accounts
    WHERE owner_user_id IS NOT NULL
    GROUP BY owner_user_id
    HAVING COUNT(*) > 1
  ) dups;

  IF v_dup_count > 0 THEN
    RAISE WARNING 'Cannot restore UNIQUE constraint idx_accounts_one_per_owner: % owner(s) have multiple workspaces. Retaining non-unique index idx_accounts_owner_user_id.', v_dup_count;
  ELSE
    DROP INDEX IF EXISTS idx_accounts_owner_user_id;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_one_per_owner ON accounts(owner_user_id);
  END IF;
END $$;
