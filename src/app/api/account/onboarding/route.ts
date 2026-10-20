import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function GET() {
  try {
    const ctx = await requireRole('agent');

    let accRes = await ctx.supabase
      .from('accounts')
      .select('id, name, onboarding_completed, acquisition_model, metadata')
      .eq('id', ctx.accountId)
      .single();

    if (accRes.error && (accRes.error.code === '42703' || accRes.error.message?.includes('acquisition_model') || accRes.error.message?.includes('metadata'))) {
      accRes = await ctx.supabase
        .from('accounts')
        .select('id, name, onboarding_completed')
        .eq('id', ctx.accountId)
        .single();
    }

    const [waRes, aiRes, websiteRes, kbRes] = await Promise.all([
      ctx.supabase
        .from('whatsapp_configs')
        .select('is_active, phone_number_id, waba_id')
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
      ctx.supabase
        .from('ai_configurations')
        .select('is_active, provider, system_prompt, persona_name')
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
      ctx.supabase
        .from('website_integrations')
        .select('site_key, is_active')
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
      ctx.supabase
        .from('ai_knowledge_documents')
        .select('id, title')
        .eq('account_id', ctx.accountId)
        .limit(1),
    ]);

    const account = accRes.data;
    const meta = (account?.metadata as Record<string, any>) || {};
    const whatsappConnected = !!(waRes.data?.is_active && waRes.data?.phone_number_id);
    const aiConfigured = !!aiRes.data?.is_active;
    const websiteConnected = !!websiteRes.data?.site_key;
    const hasKnowledge = Boolean(kbRes.data && kbRes.data.length > 0);

    return NextResponse.json({
      onboarding_completed: account?.onboarding_completed || false,
      business_name: account?.name || '',
      industry: meta.industry || 'Technology & SaaS',
      website: meta.website || '',
      timezone: meta.timezone || 'UTC',
      business_description: meta.business_description || '',
      primary_goals: meta.primary_goals || ['customer_support', 'lead_qualification'],
      agent_name: aiRes.data?.persona_name || meta.agent_name || 'Sophia',
      system_prompt: aiRes.data?.system_prompt || meta.system_prompt || '',
      steps: {
        profile_completed: Boolean(account?.name),
        whatsapp_connected: whatsappConnected,
        ai_configured: aiConfigured,
        website_connected: websiteConnected,
        knowledge_added: hasKnowledge,
      },
      website_integration: {
        site_key: websiteRes.data?.site_key || null,
      },
      whatsapp_config: {
        phone_number_id: waRes.data?.phone_number_id || null,
        is_active: Boolean(waRes.data?.is_active),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = await request.json().catch(() => ({}));

    const updates: Record<string, unknown> = {};

    if (body.business_name) {
      updates.name = String(body.business_name).trim();
    }
    if (body.completed !== undefined) {
      updates.onboarding_completed = Boolean(body.completed);
    }

    // Read existing metadata
    const { data: existingAccount } = await ctx.supabase
      .from('accounts')
      .select('metadata')
      .eq('id', ctx.accountId)
      .single();

    const existingMeta = (existingAccount?.metadata as Record<string, any>) || {};

    const newMeta: Record<string, any> = {
      ...existingMeta,
    };

    if (body.industry) newMeta.industry = String(body.industry).trim();
    if (body.website !== undefined) newMeta.website = String(body.website).trim();
    if (body.timezone) newMeta.timezone = String(body.timezone).trim();
    if (body.business_description !== undefined) newMeta.business_description = String(body.business_description).trim();
    if (Array.isArray(body.primary_goals)) newMeta.primary_goals = body.primary_goals;
    if (body.agent_name) newMeta.agent_name = String(body.agent_name).trim();
    if (body.system_prompt) newMeta.system_prompt = String(body.system_prompt).trim();

    updates.metadata = newMeta;

    let { data: updatedAccount, error: accErr } = await ctx.supabase
      .from('accounts')
      .update(updates)
      .eq('id', ctx.accountId)
      .select('id, name, onboarding_completed')
      .single();

    if (accErr && (accErr.code === '42703' || accErr.message?.includes('metadata'))) {
      const basicUpdates: Record<string, unknown> = {};
      if (updates.name) basicUpdates.name = updates.name;
      if (updates.onboarding_completed !== undefined) basicUpdates.onboarding_completed = updates.onboarding_completed;
      const fallback = await ctx.supabase
        .from('accounts')
        .update(basicUpdates)
        .eq('id', ctx.accountId)
        .select('id, name, onboarding_completed')
        .single();
      updatedAccount = fallback.data;
      accErr = fallback.error;
    }

    if (accErr) {
      return NextResponse.json({ error: accErr.message }, { status: 500 });
    }

    // If initial knowledge base fact was submitted, add to ai_knowledge_documents
    if (body.initial_knowledge && String(body.initial_knowledge).trim()) {
      try {
        await ctx.supabase
          .from('ai_knowledge_documents')
          .insert({
            account_id: ctx.accountId,
            title: 'Business Overview & Core Policies',
            content: String(body.initial_knowledge).trim(),
            created_by: ctx.userId,
          });
      } catch (kbErr) {
        console.warn('[Onboarding] initial knowledge document insert skipped/deferred:', kbErr);
      }
    }

    return NextResponse.json({
      success: true,
      account: updatedAccount,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
