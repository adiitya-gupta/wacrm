import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/admin/auth';
import { toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import type { PlanTier, SubscriptionStatus } from '@/types/billing';

export async function GET() {
  try {
    await requirePlatformAdmin();
    const db = supabaseAdmin();

    const { data: subs, error } = await db
      .from('subscriptions')
      .select(`
        *,
        accounts (
          id,
          name,
          is_suspended
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      if (error.code === '42P01' || error.code === '42703') {
        return NextResponse.json({ subscriptions: [] });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ subscriptions: subs || [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    await requirePlatformAdmin();
    const db = supabaseAdmin();
    const body = await request.json().catch(() => ({}));

    const accountId = body.account_id;
    if (!accountId) {
      return NextResponse.json({ error: 'account_id is required' }, { status: 400 });
    }

    // Action 1: Record manual offline payment (wire transfer, cash, invoice settlement)
    if (body.action === 'record_offline_payment') {
      const amount = Number(body.amount);
      const currency = body.currency || 'INR';
      const description = body.description || 'Manual offline contract payment';

      const { data: inv, error: invErr } = await db
        .from('billing_invoices')
        .insert({
          account_id: accountId,
          amount,
          currency,
          status: 'paid',
          description,
          provider_payment_id: `offline_${Date.now()}`,
          paid_at: new Date().toISOString(),
        })
        .select('*')
        .single();

      if (invErr) {
        return NextResponse.json({ error: invErr.message }, { status: 500 });
      }

      // Also set subscription to active
      await db
        .from('subscriptions')
        .update({
          status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', accountId);

      return NextResponse.json({ invoice: inv, message: 'Offline payment recorded and subscription activated' });
    }

    // Action 2: Update commercial terms (plan, custom pricing, status)
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body.plan_id) updates.plan_id = body.plan_id as PlanTier;
    if (body.status) updates.status = body.status as SubscriptionStatus;
    if (body.custom_pricing_amount !== undefined) updates.custom_pricing_amount = Number(body.custom_pricing_amount);
    if (body.custom_contract_notes !== undefined) updates.custom_contract_notes = String(body.custom_contract_notes);
    if (body.one_time_setup_fee_paid !== undefined) updates.one_time_setup_fee_paid = Boolean(body.one_time_setup_fee_paid);
    if (body.maintenance_fee_amount !== undefined) updates.maintenance_fee_amount = Number(body.maintenance_fee_amount);
    if (body.current_period_end) updates.current_period_end = body.current_period_end;

    const { data: updated, error: updateErr } = await db
      .from('subscriptions')
      .update(updates)
      .eq('account_id', accountId)
      .select('*')
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ subscription: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
