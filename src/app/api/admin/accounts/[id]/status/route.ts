import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/admin/auth';
import { toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { isApprovalStatus, type ApprovalStatus } from '@/lib/auth/approval';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminCtx = await requirePlatformAdmin();
    const { id: accountId } = await params;
    const body = await request.json().catch(() => ({}));

    const action = String(body.action || '').trim().toLowerCase(); // 'approve' | 'reject' | 'suspend' | 'reactivate'
    const reason = body.reason ? String(body.reason).trim() : null;

    const db = supabaseAdmin();

    // Verify account exists
    let { data: targetAccount, error: fetchErr } = await db
      .from('accounts')
      .select('id, name, approval_status, is_suspended, owner_user_id')
      .eq('id', accountId)
      .single();

    if (fetchErr && (fetchErr.code === '42703' || fetchErr.message?.includes('approval_status'))) {
      const fallback = await db
        .from('accounts')
        .select('id, name, is_suspended, owner_user_id')
        .eq('id', accountId)
        .single();
      targetAccount = fallback.data ? ({ ...fallback.data, approval_status: 'approved' } as any) : null;
      fetchErr = fallback.error;
    }

    if (fetchErr || !targetAccount) {
      return NextResponse.json({ error: 'Target account not found' }, { status: 404 });
    }

    // Get owner profile email for audit log
    const { data: ownerProfile } = await db
      .from('profiles')
      .select('email, user_id')
      .eq('account_id', accountId)
      .maybeSingle();

    const targetEmail = ownerProfile?.email || null;
    const targetUserId = ownerProfile?.user_id || targetAccount.owner_user_id || null;

    let newStatus: ApprovalStatus;
    let isSuspended = false;
    let auditAction = '';
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = {
      status_reason: reason,
    };

    switch (action) {
      case 'approve':
        newStatus = 'approved';
        isSuspended = false;
        auditAction = 'account.approved';
        updates.approval_status = 'approved';
        updates.is_suspended = false;
        updates.approved_at = now;
        updates.approved_by = adminCtx.userId;
        break;

      case 'reject':
        newStatus = 'rejected';
        isSuspended = false;
        auditAction = 'account.rejected';
        updates.approval_status = 'rejected';
        updates.rejected_at = now;
        break;

      case 'suspend':
        newStatus = 'suspended';
        isSuspended = true;
        auditAction = 'account.suspended';
        updates.approval_status = 'suspended';
        updates.is_suspended = true;
        updates.suspended_at = now;
        break;

      case 'reactivate':
        newStatus = 'approved';
        isSuspended = false;
        auditAction = 'account.reactivated';
        updates.approval_status = 'approved';
        updates.is_suspended = false;
        updates.approved_at = now;
        updates.approved_by = adminCtx.userId;
        break;

      default:
        return NextResponse.json(
          { error: 'Invalid action. Must be one of: approve, reject, suspend, reactivate' },
          { status: 400 }
        );
    }

    // 1. Update accounts table
    let { data: updatedAccount, error: updateErr } = await db
      .from('accounts')
      .update(updates)
      .eq('id', accountId)
      .select('id, name, is_suspended')
      .single();

    if (updateErr && (updateErr.code === '42703' || updateErr.message?.includes('approval_status'))) {
      const basicUpdates = { is_suspended: updates.is_suspended };
      const fallbackUpdate = await db
        .from('accounts')
        .update(basicUpdates)
        .eq('id', accountId)
        .select('id, name, is_suspended')
        .single();
      updatedAccount = fallbackUpdate.data ? ({ ...fallbackUpdate.data, approval_status: newStatus } as any) : null;
      updateErr = fallbackUpdate.error;
    }

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // 2. Synchronize member profiles
    await db
      .from('profiles')
      .update({ approval_status: newStatus })
      .eq('account_id', accountId);

    // 3. Record in admin_audit_logs
    try {
      await db.from('admin_audit_logs').insert({
        actor_user_id: adminCtx.userId,
        actor_email: adminCtx.callerEmail,
        action: auditAction,
        target_account_id: accountId,
        target_user_id: targetUserId,
        target_email: targetEmail,
        reason,
        metadata: {
          previous_status: targetAccount.approval_status,
          previous_suspended: targetAccount.is_suspended,
          new_status: newStatus,
          timestamp: now,
        },
      });
    } catch (auditErr) {
      console.error('[Admin Audit Log Error]:', auditErr);
    }

    return NextResponse.json({
      success: true,
      account: updatedAccount,
      action: auditAction,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
