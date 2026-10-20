-- ============================================================
-- 049_saas_billing_website_integrations_and_admin.sql
--
-- Adds:
--   1. Accounts extensions: onboarding_completed, is_suspended, acquisition_model
--   2. Subscription Plans, Subscriptions, Invoices, and Usage tracking
--   3. Website Integrations (site_key, webhook_secret, domain_whitelist)
--   4. Website Integration Rules (event-to-message automation)
--   5. Website Event Logs (audit, payload, status, retry)
--   6. RLS policies and triggers
-- ============================================================

-- 1. Extend accounts
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_suspended boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS acquisition_model text NOT NULL DEFAULT 'self_serve'; -- 'self_serve' | 'managed'

-- 2. Subscription Plans
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id                     text PRIMARY KEY, -- 'starter', 'pro', 'enterprise', 'managed_custom'
  name                   text NOT NULL,
  description            text,
  price_monthly          numeric NOT NULL DEFAULT 0,
  price_yearly           numeric NOT NULL DEFAULT 0,
  currency               text NOT NULL DEFAULT 'INR',
  monthly_messages_quota integer NOT NULL DEFAULT 1000,
  contacts_quota         integer NOT NULL DEFAULT 500,
  team_members_quota     integer NOT NULL DEFAULT 2,
  ai_tokens_quota        integer NOT NULL DEFAULT 100000,
  features               jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active              boolean NOT NULL DEFAULT true,
  is_public              boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- Seed default plans if empty
INSERT INTO public.subscription_plans (
  id, name, description, price_monthly, price_yearly, currency,
  monthly_messages_quota, contacts_quota, team_members_quota, ai_tokens_quota,
  features, is_active, is_public
) VALUES
  ('starter', 'Starter', 'For small teams getting started with WhatsApp automation', 2999, 29990, 'INR', 1000, 500, 2, 100000, '{"ai_agent": true, "flows": true, "website_integrations": true, "broadcasts": true, "custom_branding": false}', true, true),
  ('pro', 'Professional', 'For growing businesses scaling marketing, sales, and support', 6999, 69990, 'INR', 5000, 2500, 5, 500000, '{"ai_agent": true, "flows": true, "website_integrations": true, "broadcasts": true, "custom_branding": true}', true, true),
  ('enterprise', 'Enterprise', 'For large organizations needing custom limits and high concurrency', 19999, 199990, 'INR', 25000, 15000, 20, 2500000, '{"ai_agent": true, "flows": true, "website_integrations": true, "broadcasts": true, "custom_branding": true, "dedicated_support": true}', true, true),
  ('managed_custom', 'OPSIYS Managed', 'Full-service done-for-you automation, workflow design, and management', 14999, 149990, 'INR', 10000, 5000, 10, 1000000, '{"ai_agent": true, "flows": true, "website_integrations": true, "broadcasts": true, "managed_service": true}', true, false)
ON CONFLICT (id) DO NOTHING;

-- 3. Subscriptions
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id               uuid NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,
  plan_id                  text NOT NULL REFERENCES public.subscription_plans(id),
  acquisition_model        text NOT NULL DEFAULT 'self_serve', -- 'self_serve' | 'managed'
  status                   text NOT NULL DEFAULT 'trialing', -- 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'
  billing_cycle            text NOT NULL DEFAULT 'monthly', -- 'monthly', 'yearly', 'custom_contract'
  current_period_start     timestamptz NOT NULL DEFAULT now(),
  current_period_end       timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  cancel_at_period_end     boolean NOT NULL DEFAULT false,
  payment_provider         text NOT NULL DEFAULT 'razorpay', -- 'razorpay', 'stripe', 'manual_contract'
  provider_customer_id     text,
  provider_subscription_id text,
  custom_pricing_amount    numeric,
  custom_contract_notes    text,
  one_time_setup_fee_paid  boolean NOT NULL DEFAULT false,
  maintenance_fee_amount   numeric,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscriptions_account_id_idx ON public.subscriptions(account_id);
CREATE INDEX IF NOT EXISTS subscriptions_status_idx ON public.subscriptions(status);

-- 4. Billing Invoices
CREATE TABLE IF NOT EXISTS public.billing_invoices (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  subscription_id      uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  amount               numeric NOT NULL,
  currency             text NOT NULL DEFAULT 'INR',
  status               text NOT NULL DEFAULT 'paid', -- 'paid', 'pending', 'failed'
  provider_payment_id  text,
  provider_invoice_id  text,
  description          text,
  invoice_pdf_url      text,
  paid_at              timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_invoices_account_id_idx ON public.billing_invoices(account_id);

-- 5. Monthly Usage Metrics Tracking
CREATE TABLE IF NOT EXISTS public.account_usage_metrics (
  account_id       uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  billing_period   text NOT NULL, -- Format: YYYY-MM
  messages_count   integer NOT NULL DEFAULT 0,
  ai_tokens_count  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, billing_period)
);

-- Atomic increment RPC for messages & AI tokens
CREATE OR REPLACE FUNCTION public.increment_account_usage(
  p_account_id uuid,
  p_period text,
  p_messages integer DEFAULT 0,
  p_ai_tokens integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.account_usage_metrics (account_id, billing_period, messages_count, ai_tokens_count)
  VALUES (p_account_id, p_period, GREATEST(0, p_messages), GREATEST(0, p_ai_tokens))
  ON CONFLICT (account_id, billing_period)
  DO UPDATE SET
    messages_count = public.account_usage_metrics.messages_count + GREATEST(0, p_messages),
    ai_tokens_count = public.account_usage_metrics.ai_tokens_count + GREATEST(0, p_ai_tokens);
END;
$$;

-- 6. Website Integrations
CREATE TABLE IF NOT EXISTS public.website_integrations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,
  site_key         text NOT NULL UNIQUE, -- e.g. "wk_live_..."
  webhook_secret   text NOT NULL,
  domain_whitelist text[] NOT NULL DEFAULT '{}',
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS website_integrations_site_key_idx ON public.website_integrations(site_key);

-- 7. Website Integration Rules (event-to-message automation)
CREATE TABLE IF NOT EXISTS public.website_integration_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  event_type   text NOT NULL, -- 'lead.submitted', 'user.registered', 'appointment.booked', 'order.updated', 'custom'
  action_type  text NOT NULL DEFAULT 'send_whatsapp_message', -- 'send_whatsapp_message', 'send_template', 'assign_tag', 'trigger_flow'
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS website_integration_rules_acc_event_idx ON public.website_integration_rules(account_id, event_type);

-- 8. Website Event Logs
CREATE TABLE IF NOT EXISTS public.website_event_logs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  site_key           text NOT NULL,
  event_type         text NOT NULL,
  idempotency_key    text,
  payload            jsonb NOT NULL DEFAULT '{}'::jsonb,
  status             text NOT NULL DEFAULT 'accepted', -- 'accepted', 'processed', 'failed', 'retried'
  error_message      text,
  dispatched_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS website_event_logs_acc_idx ON public.website_event_logs(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS website_event_logs_idempotency_idx ON public.website_event_logs(account_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 9. Automatic Tenant Bootstrap Trigger on account creation
CREATE OR REPLACE FUNCTION public.bootstrap_tenant_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_site_key text;
  v_secret text;
BEGIN
  -- 1. Create default 14-day trial subscription on starter plan
  INSERT INTO public.subscriptions (
    account_id,
    plan_id,
    acquisition_model,
    status,
    current_period_start,
    current_period_end
  )
  VALUES (
    NEW.id,
    'starter',
    COALESCE(NEW.acquisition_model, 'self_serve'),
    'trialing',
    now(),
    now() + interval '14 days'
  )
  ON CONFLICT (account_id) DO NOTHING;

  -- 2. Generate site_key and webhook_secret for website integration
  v_site_key := 'wk_live_' || replace(gen_random_uuid()::text, '-', '');
  v_secret := 'whsec_' || replace(gen_random_uuid()::text, '-', '') || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 16);

  INSERT INTO public.website_integrations (
    account_id,
    site_key,
    webhook_secret
  )
  VALUES (
    NEW.id,
    v_site_key,
    v_secret
  )
  ON CONFLICT (account_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bootstrap_tenant_defaults ON public.accounts;
CREATE TRIGGER trg_bootstrap_tenant_defaults
  AFTER INSERT ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.bootstrap_tenant_defaults();

-- Backfill existing accounts that lack subscription or website integration
DO $$
DECLARE
  r RECORD;
  v_site_key text;
  v_secret text;
BEGIN
  FOR r IN SELECT id, acquisition_model FROM public.accounts LOOP
    INSERT INTO public.subscriptions (
      account_id, plan_id, acquisition_model, status, current_period_start, current_period_end
    )
    VALUES (
      r.id, 'starter', COALESCE(r.acquisition_model, 'self_serve'), 'active', now(), now() + interval '365 days'
    )
    ON CONFLICT (account_id) DO NOTHING;

    v_site_key := 'wk_live_' || replace(gen_random_uuid()::text, '-', '');
    v_secret := 'whsec_' || replace(gen_random_uuid()::text, '-', '') || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 16);

    INSERT INTO public.website_integrations (account_id, site_key, webhook_secret)
    VALUES (r.id, v_site_key, v_secret)
    ON CONFLICT (account_id) DO NOTHING;
  END LOOP;
END $$;

-- 10. Row Level Security Policies
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_usage_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_integration_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_event_logs ENABLE ROW LEVEL SECURITY;

-- subscription_plans: public read
DROP POLICY IF EXISTS subscription_plans_select ON public.subscription_plans;
CREATE POLICY subscription_plans_select ON public.subscription_plans FOR SELECT USING (true);

-- subscriptions: account members read, admins modify
DROP POLICY IF EXISTS subscriptions_select ON public.subscriptions;
CREATE POLICY subscriptions_select ON public.subscriptions FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS subscriptions_modify ON public.subscriptions;
CREATE POLICY subscriptions_modify ON public.subscriptions FOR ALL USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));

-- billing_invoices: account members read
DROP POLICY IF EXISTS billing_invoices_select ON public.billing_invoices;
CREATE POLICY billing_invoices_select ON public.billing_invoices FOR SELECT USING (is_account_member(account_id));

-- account_usage_metrics: account members read
DROP POLICY IF EXISTS account_usage_metrics_select ON public.account_usage_metrics;
CREATE POLICY account_usage_metrics_select ON public.account_usage_metrics FOR SELECT USING (is_account_member(account_id));

-- website_integrations: account members read, admins modify
DROP POLICY IF EXISTS website_integrations_select ON public.website_integrations;
CREATE POLICY website_integrations_select ON public.website_integrations FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS website_integrations_modify ON public.website_integrations;
CREATE POLICY website_integrations_modify ON public.website_integrations FOR ALL USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));

-- website_integration_rules: account members read, admins modify
DROP POLICY IF EXISTS website_integration_rules_select ON public.website_integration_rules;
CREATE POLICY website_integration_rules_select ON public.website_integration_rules FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS website_integration_rules_modify ON public.website_integration_rules;
CREATE POLICY website_integration_rules_modify ON public.website_integration_rules FOR ALL USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));

-- website_event_logs: account members read
DROP POLICY IF EXISTS website_event_logs_select ON public.website_event_logs;
CREATE POLICY website_event_logs_select ON public.website_event_logs FOR SELECT USING (is_account_member(account_id));
