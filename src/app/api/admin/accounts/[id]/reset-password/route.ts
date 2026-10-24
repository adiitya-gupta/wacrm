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
    const { id: accountId } = await params;
    const db = supabaseAdmin();

    // 1. Verify account exists
    const { data: account, error: accErr } = await db
      .from('accounts')
      .select('id, name, owner_user_id')
      .eq('id', accountId)
      .single();

    if (accErr || !account) {
      return NextResponse.json({ error: 'Client account not found' }, { status: 404 });
    }

    // 2. Identify client owner email
    let clientEmail: string | null = null;
    let clientUserId: string | null = null;

    const { data: profile } = await db
      .from('profiles')
      .select('email, user_id')
      .eq('account_id', accountId)
      .eq('account_role', 'owner')
      .maybeSingle();

    if (profile?.email) {
      clientEmail = profile.email;
      clientUserId = profile.user_id;
    } else if (account.owner_user_id) {
      const { data: authUser } = await db.auth.admin.getUserById(account.owner_user_id);
      if (authUser?.user?.email) {
        clientEmail = authUser.user.email;
        clientUserId = authUser.user.id;
      }
    }

    // If still not resolved, look for any account member
    if (!clientEmail) {
      const { data: anyMember } = await db
        .from('profiles')
        .select('email, user_id')
        .eq('account_id', accountId)
        .not('email', 'is', null)
        .limit(1)
        .maybeSingle();

      if (anyMember?.email) {
        clientEmail = anyMember.email;
        clientUserId = anyMember.user_id;
      }
    }

    if (!clientEmail) {
      return NextResponse.json(
        { error: 'No user email found associated with this client account' },
        { status: 400 }
      );
    }

    // 3. Generate secure password reset recovery link using server-side Supabase Admin API
    const origin = new URL(request.url).origin;
    const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent('/reset-password')}`;

    const { data: linkData, error: linkErr } = await db.auth.admin.generateLink({
      type: 'recovery',
      email: clientEmail,
      options: { redirectTo },
    });

    if (linkErr) {
      console.error('[Admin Reset Password Error]:', linkErr);
      return NextResponse.json(
        { error: `Failed to generate password reset: ${linkErr.message}` },
        { status: 500 }
      );
    }

    const actionLink = linkData?.properties?.action_link || null;

    // 4. Record in administrative audit log
    try {
      await db.from('admin_audit_logs').insert({
        actor_user_id: adminCtx.userId,
        actor_email: adminCtx.callerEmail,
        action: 'account.password_reset_initiated',
        target_account_id: accountId,
        target_user_id: clientUserId,
        target_email: clientEmail,
        reason: 'Platform owner initiated password reset',
        metadata: {
          timestamp: new Date().toISOString(),
          has_action_link: Boolean(actionLink),
        },
      });
    } catch {
      // Non-blocking if table is unavailable
    }

    return NextResponse.json({
      success: true,
      message: `Password reset link generated for ${clientEmail}`,
      email: clientEmail,
      reset_link: actionLink,
      reset_url: actionLink,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
