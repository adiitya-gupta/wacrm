-- ============================================================
-- 052_permanent_owner_protection.sql
--
-- Wattomation Permanent Platform Owner Protection
--
-- Enforces database-level protection preventing ordinary administrative
-- actions or tenant operations from suspending, rejecting, deactivating,
-- or demoting the authoritative permanent Platform Owner
-- (adityaofficial9918@gmail.com).
-- ============================================================

SET search_path TO public, auth, extensions;

-- ============================================================
-- 1. Permanent Platform Owner Protection Trigger Function
-- ============================================================
CREATE OR REPLACE FUNCTION public.enforce_platform_owner_protection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_canonical_owner CONSTANT text := 'adityaofficial9918@gmail.com';
  v_is_owner_target boolean := false;
BEGIN
  -- A. Protection on public.accounts
  IF TG_TABLE_NAME = 'accounts' THEN
    IF (NEW.is_suspended = true OR NEW.approval_status IN ('suspended', 'rejected')) THEN
      -- Check whether account has an associated profile belonging to the platform owner
      SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE account_id = NEW.id
          AND LOWER(TRIM(email)) = LOWER(v_canonical_owner)
      ) INTO v_is_owner_target;

      -- Check whether accounts.owner_user_id belongs to the platform owner
      IF NOT v_is_owner_target AND NEW.owner_user_id IS NOT NULL THEN
        SELECT EXISTS (
          SELECT 1 FROM auth.users
          WHERE id = NEW.owner_user_id
            AND LOWER(TRIM(email)) = LOWER(v_canonical_owner)
        ) INTO v_is_owner_target;
      END IF;

      -- Check whether this is the designated platform admin account
      IF NOT v_is_owner_target AND NEW.id = '7498de6d-f333-457d-8545-ef34fdd10c54'::uuid THEN
        v_is_owner_target := true;
      END IF;

      IF v_is_owner_target THEN
        RAISE EXCEPTION 'Cannot suspend or reject the permanent Platform Owner account (%)'
          , v_canonical_owner
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
  END IF;

  -- B. Protection on public.profiles
  IF TG_TABLE_NAME = 'profiles' THEN
    IF (
      NEW.approval_status IN ('suspended', 'rejected')
      OR (
        TG_OP = 'UPDATE' AND (
          (OLD.account_role = 'owner' AND NEW.account_role <> 'owner')
          OR (OLD.role = 'owner' AND NEW.role <> 'owner')
          OR (LOWER(TRIM(COALESCE(OLD.email, ''))) = LOWER(v_canonical_owner) AND LOWER(TRIM(COALESCE(NEW.email, ''))) <> LOWER(v_canonical_owner))
        )
      )
    ) THEN
      IF (
        LOWER(TRIM(COALESCE(NEW.email, ''))) = LOWER(v_canonical_owner)
        OR (TG_OP = 'UPDATE' AND LOWER(TRIM(COALESCE(OLD.email, ''))) = LOWER(v_canonical_owner))
      ) THEN
        RAISE EXCEPTION 'Cannot demote, suspend, or reject the permanent Platform Owner profile (%)'
          , v_canonical_owner
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_platform_owner_protection() OWNER TO postgres;

-- Attach trigger to public.accounts
DROP TRIGGER IF EXISTS trg_enforce_platform_owner_accounts ON public.accounts;
CREATE TRIGGER trg_enforce_platform_owner_accounts
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_platform_owner_protection();

-- Attach trigger to public.profiles
DROP TRIGGER IF EXISTS trg_enforce_platform_owner_profiles ON public.profiles;
CREATE TRIGGER trg_enforce_platform_owner_profiles
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_platform_owner_protection();
