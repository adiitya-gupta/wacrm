import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/admin/auth';
import { toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';

interface TenantAccountRow {
  id: string;
  name: string;
  created_at: string;
  is_suspended: boolean | null;
  acquisition_model?: string | null;
  onboarding_completed: boolean | null;
  owner_user_id: string | null;
}

export async function GET(request: Request) {
  try {
    await requirePlatformAdmin();
    const db = supabaseAdmin();

    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('model'); // 'all' | 'managed' | 'self_serve'

    let query = db
      .from('accounts')
      .select(`
        id,
        name,
        created_at,
        is_suspended,
        acquisition_model,
        onboarding_completed,
        owner_user_id
      `)
      .order('created_at', { ascending: false });

    if (filter === 'managed') {
      query = query.eq('acquisition_model', 'managed');
    } else if (filter === 'self_serve') {
      query = query.eq('acquisition_model', 'self_serve');
    }

    let { data: accounts, error } = await query;
    if (error && (error.code === '42703' || error.message?.includes('acquisition_model'))) {
      const fallback = await db
        .from('accounts')
        .select(`
          id,
          name,
          created_at,
          is_suspended,
          onboarding_completed,
          owner_user_id
        `)
        .order('created_at', { ascending: false });
      accounts = ((fallback.data as Omit<TenantAccountRow, 'acquisition_model'>[] | null) || []).map((a) => ({ ...a, acquisition_model: 'self_serve' }));
      error = fallback.error;
    }
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Enrich with subscription status and owner profile
    const accountIds = (accounts || []).map((a) => a.id);
    const [subsRes, profilesRes, waRes] = await Promise.all([
      db.from('subscriptions').select('*').in('account_id', accountIds),
      db.from('profiles').select('user_id, account_id, full_name, email').in('account_id', accountIds),
      db.from('whatsapp_configs').select('account_id, is_active, phone_number_id').in('account_id', accountIds),
    ]);

    const subsMap = new Map((subsRes.data || []).map((s) => [s.account_id, s]));
    const profilesMap = new Map((profilesRes.data || []).map((p) => [p.account_id, p]));
    const waMap = new Map((waRes.data || []).map((w) => [w.account_id, w]));

    const enriched = (accounts || []).map((acc) => {
      const sub = subsMap.get(acc.id);
      const profile = profilesMap.get(acc.id);
      const wa = waMap.get(acc.id);

      return {
        ...acc,
        owner_name: profile?.full_name || 'Unassigned',
        owner_email: profile?.email || 'N/A',
        subscription: sub || null,
        whatsapp_connected: !!(wa?.is_active && wa?.phone_number_id),
      };
    });

    return NextResponse.json({ tenants: enriched });
  } catch (err) {
    return toErrorResponse(err);
  }
}
