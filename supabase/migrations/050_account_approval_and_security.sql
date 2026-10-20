-- ============================================================
-- 050_account_approval_and_security.sql
--
-- Adds:
--   1. Approval status on public.accounts and public.profiles:
--      'pending' | 'approved' | 'rejected' | 'suspended'
--   2. Audit columns: approved_at, approved_by, rejected_at, suspended_at, status_reason
--   3. Administrative Audit Logs table: admin_audit_logs
--   4. Triggers to prevent users from modifying their own approval status or suspension
--   5. Updates handle_new_user() to default new signups to 'pending'
--   6. Hardens is_account_member() to fail-closed if account is not approved or is suspended
--   7. Safe deliberate migration for existing accounts preserving platform administrator
-- ============================================================

-- 1. Extend public.accounts with approval columns and suspension flag
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS is_suspended boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'rejected', 'suspended')),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_reason text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_accounts_is_suspended ON public.accounts(is_suspended);
CREATE INDEX IF NOT EXISTS idx_accounts_approval_status ON public.accounts(approval_status);

-- 2. Extend public.profiles with approval_status
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'rejected', 'suspended'));

CREATE INDEX IF NOT EXISTS idx_profiles_user_approval ON public.profiles(user_id, approval_status);

-- 3. Admin Audit Logs table
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text NOT NULL,
  action text NOT NULL, -- 'account.approved' | 'account.rejected' | 'account.suspended' | 'account.reactivated'
  target_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_email text,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_action ON public.admin_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_target_acc ON public.admin_audit_logs(target_account_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created ON public.admin_audit_logs(created_at DESC);

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
-- Default deny all for ordinary authenticated clients; accessed via service_role / security definer
DROP POLICY IF EXISTS admin_audit_logs_select ON public.admin_audit_logs;
CREATE POLICY admin_audit_logs_select ON public.admin_audit_logs FOR SELECT USING (false);

-- 4. Prevent self-service modification of privilege and approval columns
-- Update profiles trigger
CREATE OR REPLACE FUNCTION public.enforce_profile_privilege_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.account_role IS DISTINCT FROM OLD.account_role
      OR NEW.account_id IS DISTINCT FROM OLD.account_id
      OR NEW.approval_status IS DISTINCT FROM OLD.approval_status)
     AND current_user = 'authenticated'
  THEN
    RAISE EXCEPTION
      'account_role, account_id, and approval_status cannot be changed directly; requires administrative authorization'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_profile_privilege_columns() OWNER TO postgres;

DROP TRIGGER IF EXISTS enforce_profile_privilege_columns ON public.profiles;
CREATE TRIGGER enforce_profile_privilege_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_privilege_columns();

-- Accounts trigger to guard approval_status and is_suspended from browser modifications
CREATE OR REPLACE FUNCTION public.enforce_account_privilege_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.approval_status IS DISTINCT FROM OLD.approval_status
      OR NEW.is_suspended IS DISTINCT FROM OLD.is_suspended)
     AND current_user = 'authenticated'
  THEN
    RAISE EXCEPTION
      'Account approval status and suspension cannot be modified directly; requires platform administrator authorization'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_account_privilege_columns() OWNER TO postgres;

DROP TRIGGER IF EXISTS enforce_account_privilege_columns ON public.accounts;
CREATE TRIGGER enforce_account_privilege_columns
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_account_privilege_columns();

-- 5. Update handle_new_user to ensure new signups default to 'pending'
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.accounts (name, owner_user_id, approval_status, is_suspended)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id, 'pending', false)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role, approval_status)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner', 'pending');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

-- 6. Harden is_account_member() so only approved, non-suspended accounts can access operational data
CREATE OR REPLACE FUNCTION is_account_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    JOIN accounts a ON a.id = p.account_id
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND a.approval_status = 'approved'
      AND a.is_suspended = false
      AND (p.approval_status = 'approved' OR p.approval_status IS NULL)
      AND CASE p.account_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
        >=
          CASE min_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
  );
$$;

ALTER FUNCTION is_account_member(UUID, account_role_enum) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_account_member(UUID, account_role_enum) TO authenticated, service_role;

-- Ensure account owners can still read their own account row to discover their status
DROP POLICY IF EXISTS accounts_select ON accounts;
CREATE POLICY accounts_select ON accounts FOR SELECT
  USING (is_account_member(id) OR owner_user_id = auth.uid());

-- 7. Deliberate migration policy for existing accounts:
-- Preserve designated platform administrator account
UPDATE public.accounts
SET approval_status = 'approved', approved_at = now()
WHERE id = '7498de6d-f333-457d-8545-ef34fdd10c54'::uuid
   OR id IN (
     SELECT account_id FROM public.profiles WHERE email ILIKE 'adityaofficial9918@gmail.com' OR email ILIKE 'adityaofficial2018@gmail.com'
   );

UPDATE public.profiles
SET approval_status = 'approved'
WHERE account_id = '7498de6d-f333-457d-8545-ef34fdd10c54'::uuid
   OR email ILIKE 'adityaofficial9918@gmail.com'
   OR email ILIKE 'adityaofficial2018@gmail.com';

-- Mark existing accounts that were marked suspended as 'suspended'
UPDATE public.accounts
SET approval_status = 'suspended', suspended_at = now()
WHERE is_suspended = true AND approval_status != 'approved';

-- Mark existing accounts that have an active subscription as approved (if subscriptions table exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'subscriptions'
  ) THEN
    UPDATE public.accounts
    SET approval_status = 'approved', approved_at = now()
    WHERE id IN (SELECT account_id FROM public.subscriptions WHERE status = 'active')
      AND approval_status != 'suspended';
  END IF;
END $$;

UPDATE public.profiles
SET approval_status = 'approved'
WHERE account_id IN (SELECT id FROM public.accounts WHERE approval_status = 'approved');
