import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/admin/auth';
import { toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { generateInviteToken } from '@/lib/auth/invitations';
import { getOrCreateWebsiteIntegration } from '@/lib/website-integrations/service';
import type { PlanTier, AcquisitionModel } from '@/types/billing';

export async function POST(request: Request) {
  try {
    const adminCtx = await requirePlatformAdmin();
    const db = supabaseAdmin();
    const body = await request.json().catch(() => ({}));

    const businessName = String(body.business_name || '').trim();
    const ownerEmail = String(body.owner_email || '').trim().toLowerCase();
    const ownerFullName = String(body.owner_full_name || '').trim();
    const planId = (body.plan_id as PlanTier) || 'managed_custom';
    const acquisitionModel = (body.acquisition_model as AcquisitionModel) || 'managed';
    const customPricingAmount = body.custom_pricing_amount ? Number(body.custom_pricing_amount) : null;
    const customContractNotes = body.custom_contract_notes ? String(body.custom_contract_notes).trim() : null;
    const oneTimeSetupFeePaid = Boolean(body.one_time_setup_fee_paid);
    const maintenanceFeeAmount = body.maintenance_fee_amount ? Number(body.maintenance_fee_amount) : null;

    if (!businessName) {
      return NextResponse.json({ error: 'Business name is required' }, { status: 400 });
    }
    if (!ownerEmail || !ownerEmail.includes('@')) {
      return NextResponse.json({ error: 'Valid client owner email is required' }, { status: 400 });
    }

    // 1. Create the new account workspace
    const now = new Date().toISOString();
    let { data: newAccount, error: accErr } = await db
      .from('accounts')
      .insert({
        name: businessName,
        acquisition_model: acquisitionModel,
        onboarding_completed: true, // Managed by OPSIYS
        owner_user_id: adminCtx.userId, // Initially attributed to creator, transferred on client acceptance
        approval_status: 'approved',
        approved_at: now,
        approved_by: adminCtx.userId,
      })
      .select('id, name, created_at')
      .single();

    if (accErr && (accErr.code === '42703' || accErr.message?.includes('approval_status') || accErr.message?.includes('acquisition_model'))) {
      const fallback = await db
        .from('accounts')
        .insert({
          name: businessName,
          onboarding_completed: true,
          owner_user_id: adminCtx.userId,
        })
        .select('id, name, created_at')
        .single();
      newAccount = fallback.data;
      accErr = fallback.error;
    }

    if (accErr || !newAccount) {
      return NextResponse.json({ error: accErr?.message || 'Failed to create workspace' }, { status: 500 });
    }

    const accountId = newAccount.id;

    // 2. Setup subscription & contract terms
    const periodEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    await db
      .from('subscriptions')
      .upsert(
        {
          account_id: accountId,
          plan_id: planId,
          acquisition_model: acquisitionModel,
          status: 'active',
          billing_cycle: customPricingAmount ? 'custom_contract' : 'monthly',
          current_period_start: new Date().toISOString(),
          current_period_end: periodEnd,
          custom_pricing_amount: customPricingAmount,
          custom_contract_notes: customContractNotes,
          one_time_setup_fee_paid: oneTimeSetupFeePaid,
          maintenance_fee_amount: maintenanceFeeAmount,
          payment_provider: 'manual_contract',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'account_id' }
      );

    // 3. Generate website integration credentials
    const integration = await getOrCreateWebsiteIntegration(db, accountId);

    // 4. Generate client invitation token so the client can redeem and access their finished workspace
    const { token, hash } = generateInviteToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

    await db.from('account_invitations').insert({
      account_id: accountId,
      email: ownerEmail,
      role: 'owner',
      token_hash: hash,
      expires_at: expiresAt,
      invited_by: adminCtx.userId,
    });

    // 5. Record administrative audit log
    try {
      await db.from('admin_audit_logs').insert({
        actor_user_id: adminCtx.userId,
        actor_email: adminCtx.callerEmail,
        action: 'tenant.provisioned',
        target_account_id: accountId,
        target_email: ownerEmail,
        reason: customContractNotes || 'Managed client workspace provisioning',
        metadata: {
          business_name: businessName,
          plan_id: planId,
          acquisition_model: acquisitionModel,
          custom_pricing: customPricingAmount,
          timestamp: now,
        },
      });
    } catch {
      // Ignored if table doesn't exist yet
    }

    const origin = new URL(request.url).origin;
    const inviteUrl = `${origin}/join/${token}`;

    return NextResponse.json({
      success: true,
      account: {
        id: accountId,
        name: businessName,
        acquisition_model: acquisitionModel,
        plan_id: planId,
        website_integration: {
          site_key: integration.site_key,
          webhook_secret: integration.webhook_secret,
        },
      },
      client_invitation: {
        email: ownerEmail,
        full_name: ownerFullName,
        invite_url: inviteUrl,
        expires_at: expiresAt,
      },
    }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
