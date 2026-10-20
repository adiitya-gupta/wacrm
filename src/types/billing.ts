export type PlanTier = 'starter' | 'pro' | 'enterprise' | 'managed_custom';

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'paused';

export type AcquisitionModel = 'self_serve' | 'managed';

export type BillingCycle = 'monthly' | 'yearly' | 'custom_contract';

export interface PlanFeatures {
  ai_agent?: boolean;
  flows?: boolean;
  website_integrations?: boolean;
  broadcasts?: boolean;
  custom_branding?: boolean;
  dedicated_support?: boolean;
  managed_service?: boolean;
  [key: string]: boolean | undefined;
}

export interface SubscriptionPlan {
  id: PlanTier;
  name: string;
  description: string | null;
  price_monthly: number;
  price_yearly: number;
  currency: string;
  monthly_messages_quota: number;
  contacts_quota: number;
  team_members_quota: number;
  ai_tokens_quota: number;
  features: PlanFeatures;
  is_active: boolean;
  is_public: boolean;
  created_at: string;
}

export interface Subscription {
  id: string;
  account_id: string;
  plan_id: PlanTier;
  acquisition_model: AcquisitionModel;
  status: SubscriptionStatus;
  billing_cycle: BillingCycle;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  payment_provider: 'razorpay' | 'stripe' | 'manual_contract';
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  custom_pricing_amount: number | null;
  custom_contract_notes: string | null;
  one_time_setup_fee_paid: boolean;
  maintenance_fee_amount: number | null;
  created_at: string;
  updated_at: string;
  plan?: SubscriptionPlan;
}

export interface BillingInvoice {
  id: string;
  account_id: string;
  subscription_id: string | null;
  amount: number;
  currency: string;
  status: 'paid' | 'pending' | 'failed';
  provider_payment_id: string | null;
  provider_invoice_id: string | null;
  description: string | null;
  invoice_pdf_url: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface AccountUsageSummary {
  period: string; // YYYY-MM
  messages_sent: number;
  messages_quota: number;
  ai_tokens_used: number;
  ai_tokens_quota: number;
  contacts_count: number;
  contacts_quota: number;
  team_members_count: number;
  team_members_quota: number;
  is_quota_exceeded: boolean;
}
