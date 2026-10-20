import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/admin/auth';
import { toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { getCurrentBillingPeriod } from '@/lib/billing/quota';

export async function GET() {
  try {
    await requirePlatformAdmin();
    const db = supabaseAdmin();
    const period = getCurrentBillingPeriod();

    const [
      accountsRes,
      subscriptionsRes,
      usageRes,
      integrationsRes,
      aiConfigsRes,
    ] = await Promise.all([
      db.from('accounts').select('*', { count: 'exact', head: true }),
      db.from('subscriptions').select('plan_id, status, acquisition_model'),
      db.from('account_usage_metrics').select('messages_count, ai_tokens_count').eq('billing_period', period),
      db.from('website_integrations').select('*', { count: 'exact', head: true }),
      db.from('ai_configurations').select('account_id').eq('is_active', true),
    ]);

    const totalTenants = accountsRes.count || 0;
    const subs = subscriptionsRes.data || [];
    const activeSubs = subs.filter((s) => s.status === 'active' || s.status === 'trialing');
    const managedTenants = subs.filter((s) => s.acquisition_model === 'managed').length;
    const selfServeTenants = totalTenants - managedTenants;

    const usage = usageRes.data || [];
    const totalMessagesPeriod = usage.reduce((acc, row) => acc + (row.messages_count || 0), 0);
    const totalAiTokensPeriod = usage.reduce((acc, row) => acc + (row.ai_tokens_count || 0), 0);

    return NextResponse.json({
      metrics: {
        total_tenants: totalTenants,
        active_subscriptions: activeSubs.length,
        managed_tenants: managedTenants,
        self_serve_tenants: selfServeTenants,
        total_website_integrations: integrationsRes.count || 0,
        active_ai_agents: aiConfigsRes.data?.length || 0,
        current_period: period,
        total_messages_period: totalMessagesPeriod,
        total_ai_tokens_period: totalAiTokensPeriod,
        system_status: 'healthy',
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
