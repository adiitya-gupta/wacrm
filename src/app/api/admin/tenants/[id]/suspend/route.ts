import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/admin/auth';
import { toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminCtx = await requirePlatformAdmin();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const is_suspended = Boolean(body.is_suspended);
    const reason = body.reason ? String(body.reason).trim() : null;

    const db = supabaseAdmin();
    const now = new Date().toISOString();
    const newStatus = is_suspended ? 'suspended' : 'approved';

    let { data, error } = await db
      .from('accounts')
      .update({
        is_suspended,
        approval_status: newStatus,
        suspended_at: is_suspended ? now : null,
        status_reason: reason,
      })
      .eq('id', id)
      .select('id, name, is_suspended')
      .single();

    if (error && (error.code === '42703' || error.message?.includes('approval_status'))) {
      const fallback = await db
        .from('accounts')
        .update({ is_suspended })
        .eq('id', id)
        .select('id, name, is_suspended')
        .single();
      data = fallback.data;
      error = fallback.error;
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Synchronize member profiles
    try {
      await db
        .from('profiles')
        .update({ approval_status: newStatus })
        .eq('account_id', id);
    } catch {
      // Ignored if column doesn't exist yet
    }

    // Record in admin_audit_logs
    try {
      await db.from('admin_audit_logs').insert({
        actor_user_id: adminCtx.userId,
        actor_email: adminCtx.callerEmail,
        action: is_suspended ? 'account.suspended' : 'account.reactivated',
        target_account_id: id,
        reason,
        metadata: {
          is_suspended,
          new_status: newStatus,
          timestamp: now,
        },
      });
    } catch {
      // Ignored if audit table doesn't exist yet
    }

    return NextResponse.json({ account: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
