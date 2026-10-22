import type { SupabaseClient } from '@supabase/supabase-js';
import { getPlanDetails } from './plans';
import type { PlanTier, AccountUsageSummary } from '@/types/billing';

export function getCurrentBillingPeriod(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export interface QuotaCheckResult {
  allowed: boolean;
  current: number;
  quota: number;
  reason?: string;
}

interface AccountSubscriptionRow {
  plan_id?: string | null;
  status?: string | null;
  current_period_end?: string | null;
}

/**
 * Checks whether an account is allowed to consume a specific resource under its current plan.
 * Returns { allowed: true } or { allowed: false, reason: "..." }.
 */
export async function checkAccountQuota(
  db: SupabaseClient,
  accountId: string,
  resource: 'messages' | 'contacts' | 'team_members' | 'ai_tokens',
  delta = 1
): Promise<QuotaCheckResult> {
  try {
    // 1. Fetch account subscription status
    let sub: AccountSubscriptionRow | null = null;
    try {
      const res = await db
        .from('subscriptions')
        .select('plan_id, status, current_period_end')
        .eq('account_id', accountId)
        .maybeSingle();
      sub = res.data;
    } catch {
      sub = null;
    }

    const planId = (sub?.plan_id as PlanTier) || 'starter';
    const plan = getPlanDetails(planId);
    const status = sub?.status || 'active';

    // If subscription is past_due, canceled, unpaid, or paused, disallow write actions
    if (status === 'past_due' || status === 'unpaid' || status === 'canceled' || status === 'paused') {
      return {
        allowed: false,
        current: 0,
        quota: 0,
        reason: `Account subscription is ${status}. Please update payment method or contact support.`,
      };
    }

    // 2. Resource-specific quota checks
    const period = getCurrentBillingPeriod();

    if (resource === 'messages') {
      let current = 0;
      try {
        const { data: metrics } = await db
          .from('account_usage_metrics')
          .select('messages_count')
          .eq('account_id', accountId)
          .eq('billing_period', period)
          .maybeSingle();
        current = typeof metrics?.messages_count === 'number' ? metrics.messages_count : 0;
      } catch {
        current = 0;
      }

      const quota = plan.monthly_messages_quota;
      if (current + delta > quota) {
        return {
          allowed: false,
          current,
          quota,
          reason: `Monthly message quota exceeded (${current}/${quota}). Upgrade your plan to send more messages.`,
        };
      }
      return { allowed: true, current, quota };
    }

    if (resource === 'ai_tokens') {
      let current = 0;
      try {
        const { data: metrics } = await db
          .from('account_usage_metrics')
          .select('ai_tokens_count')
          .eq('account_id', accountId)
          .eq('billing_period', period)
          .maybeSingle();
        current = typeof metrics?.ai_tokens_count === 'number' ? metrics.ai_tokens_count : 0;
      } catch {
        current = 0;
      }

      const quota = plan.ai_tokens_quota;
      if (current + delta > quota) {
        return {
          allowed: false,
          current,
          quota,
          reason: `Monthly AI token quota exceeded (${current}/${quota}). Upgrade your plan to increase limit.`,
        };
      }
      return { allowed: true, current, quota };
    }

    if (resource === 'contacts') {
      let current = 0;
      try {
        const { count, error } = await db
          .from('contacts')
          .select('*', { count: 'exact', head: true })
          .eq('account_id', accountId);
        current = error ? 0 : (count || 0);
      } catch {
        current = 0;
      }

      const quota = plan.contacts_quota;
      if (current + delta > quota) {
        return {
          allowed: false,
          current,
          quota,
          reason: `Contact limit reached (${current}/${quota}). Upgrade your plan to store more contacts.`,
        };
      }
      return { allowed: true, current, quota };
    }

    if (resource === 'team_members') {
      let current = 1;
      try {
        const { count, error } = await db
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .eq('account_id', accountId);
        current = error ? 1 : (count || 1);
      } catch {
        current = 1;
      }

      const quota = plan.team_members_quota;
      if (current + delta > quota) {
        return {
          allowed: false,
          current,
          quota,
          reason: `Team member limit reached (${current}/${quota}). Upgrade your plan to add more team members.`,
        };
      }
      return { allowed: true, current, quota };
    }

    return { allowed: true, current: 0, quota: 999999 };
  } catch {
    return { allowed: true, current: 0, quota: 999999 };
  }
}

/**
 * Increment account usage atomically.
 */
export async function incrementAccountUsage(
  db: SupabaseClient,
  accountId: string,
  usage: { messages?: number; aiTokens?: number }
): Promise<void> {
  const period = getCurrentBillingPeriod();
  const messages = usage.messages || 0;
  const aiTokens = usage.aiTokens || 0;

  if (messages === 0 && aiTokens === 0) return;

  try {
    await db.rpc('increment_account_usage', {
      p_account_id: accountId,
      p_period: period,
      p_messages: messages,
      p_ai_tokens: aiTokens,
    });
  } catch (err) {
    console.error('[quota] Failed to increment account usage:', err);
  }
}

/**
 * Get comprehensive usage summary for the account dashboard.
 */
export async function getAccountUsageSummary(
  db: SupabaseClient,
  accountId: string
): Promise<AccountUsageSummary> {
  const period = getCurrentBillingPeriod();

  const [subRes, metricsRes, contactsRes, membersRes] = await Promise.all([
    db.from('subscriptions').select('plan_id, status').eq('account_id', accountId).maybeSingle(),
    db.from('account_usage_metrics').select('messages_count, ai_tokens_count').eq('account_id', accountId).eq('billing_period', period).maybeSingle(),
    db.from('contacts').select('*', { count: 'exact', head: true }).eq('account_id', accountId),
    db.from('profiles').select('*', { count: 'exact', head: true }).eq('account_id', accountId),
  ]);

  const planId = (subRes.data?.plan_id as PlanTier) || 'starter';
  const plan = getPlanDetails(planId);

  const messagesSent = metricsRes.data?.messages_count || 0;
  const aiTokensUsed = metricsRes.data?.ai_tokens_count || 0;
  const contactsCount = contactsRes.count || 0;
  const teamMembersCount = membersRes.count || 1;

  const isQuotaExceeded =
    messagesSent >= plan.monthly_messages_quota ||
    contactsCount >= plan.contacts_quota ||
    teamMembersCount >= plan.team_members_quota ||
    aiTokensUsed >= plan.ai_tokens_quota;

  return {
    period,
    messages_sent: messagesSent,
    messages_quota: plan.monthly_messages_quota,
    ai_tokens_used: aiTokensUsed,
    ai_tokens_quota: plan.ai_tokens_quota,
    contacts_count: contactsCount,
    contacts_quota: plan.contacts_quota,
    team_members_count: teamMembersCount,
    team_members_quota: plan.team_members_quota,
    is_quota_exceeded: isQuotaExceeded,
  };
}
