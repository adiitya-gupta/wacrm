import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/admin/auth';
import { toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';

export async function GET(request: Request) {
  try {
    await requirePlatformAdmin();
    const db = supabaseAdmin();

    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status'); // 'all' | 'pending' | 'approved' | 'rejected' | 'suspended'
    const searchQuery = searchParams.get('q')?.trim().toLowerCase() || '';

    // Fetch all accounts
    let { data: accounts, error: accErr } = await db
      .from('accounts')
      .select(`
        id,
        name,
        created_at,
        approval_status,
        is_suspended,
        approved_at,
        approved_by,
        rejected_at,
        suspended_at,
        status_reason,
        onboarding_completed,
        owner_user_id
      `)
      .order('created_at', { ascending: false });

    if (accErr && (accErr.code === '42703' || accErr.message?.includes('approval_status'))) {
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
      accounts = fallback.data?.map((a: any) => ({
        ...a,
        approval_status: a.is_suspended ? 'suspended' : 'approved',
        approved_at: null,
        approved_by: null,
        rejected_at: null,
        suspended_at: null,
        status_reason: null,
      })) || [];
      accErr = fallback.error;
    }

    if (accErr) {
      return NextResponse.json({ error: accErr.message }, { status: 500 });
    }

    const allAccounts = accounts || [];
    const accountIds = allAccounts.map((a) => a.id);

    // Fetch profiles for these accounts
    let { data: profiles, error: profErr } = await db
      .from('profiles')
      .select('user_id, account_id, full_name, email, created_at, role, account_role, approval_status')
      .in('account_id', accountIds);

    if (profErr && (profErr.code === '42703' || profErr.message?.includes('approval_status'))) {
      const fallbackProf = await db
        .from('profiles')
        .select('user_id, account_id, full_name, email, created_at, role, account_role')
        .in('account_id', accountIds);
      profiles = fallbackProf.data?.map((p: any) => ({ ...p, approval_status: 'approved' })) || [];
    }

    const profilesByAccount = new Map<string, any[]>();
    for (const p of profiles || []) {
      if (p.account_id) {
        const list = profilesByAccount.get(p.account_id) || [];
        list.push(p);
        profilesByAccount.set(p.account_id, list);
      }
    }

    // Enrich accounts
    const enriched = allAccounts.map((acc) => {
      const accProfiles = profilesByAccount.get(acc.id) || [];
      const ownerProfile = accProfiles.find((p) => p.user_id === acc.owner_user_id) || accProfiles[0] || null;

      // Determine clean status
      let effectiveStatus = acc.approval_status || 'pending';
      if (acc.is_suspended) {
        effectiveStatus = 'suspended';
      }

      return {
        id: acc.id,
        name: acc.name,
        created_at: acc.created_at,
        approval_status: effectiveStatus,
        is_suspended: Boolean(acc.is_suspended),
        approved_at: acc.approved_at,
        rejected_at: acc.rejected_at,
        suspended_at: acc.suspended_at,
        status_reason: acc.status_reason,
        onboarding_completed: Boolean(acc.onboarding_completed),
        owner_name: ownerProfile?.full_name || 'Unassigned',
        owner_email: ownerProfile?.email || 'N/A',
        members_count: accProfiles.length,
      };
    });

    // Compute status overview counts
    const counts = {
      total: enriched.length,
      pending: enriched.filter((a) => a.approval_status === 'pending').length,
      approved: enriched.filter((a) => a.approval_status === 'approved').length,
      rejected: enriched.filter((a) => a.approval_status === 'rejected').length,
      suspended: enriched.filter((a) => a.approval_status === 'suspended').length,
    };

    // Apply filters
    let filtered = enriched;
    if (statusFilter && statusFilter !== 'all') {
      filtered = filtered.filter((a) => a.approval_status === statusFilter);
    }
    if (searchQuery) {
      filtered = filtered.filter(
        (a) =>
          a.name.toLowerCase().includes(searchQuery) ||
          a.owner_name.toLowerCase().includes(searchQuery) ||
          a.owner_email.toLowerCase().includes(searchQuery)
      );
    }

    return NextResponse.json({
      counts,
      accounts: filtered,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
