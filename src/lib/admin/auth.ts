import { getCurrentAccount, ForbiddenError, type AccountContext } from '@/lib/auth/account';

/**
 * Check whether a given account context represents an authorized platform administrator.
 * Evaluates against OPSIYS_ACCOUNT_ID and PLATFORM_ADMIN_EMAILS.
 */
export function isPlatformAdmin(ctx: {
  accountId: string;
  email?: string | null;
  role: string;
}): boolean {
  const opsiysAccountId = process.env.OPSIYS_ACCOUNT_ID?.trim();
  if (opsiysAccountId && ctx.accountId === opsiysAccountId) {
    return ctx.role === 'owner' || ctx.role === 'admin';
  }

  const adminEmails = process.env.PLATFORM_ADMIN_EMAILS
    ? process.env.PLATFORM_ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
    : [];

  if (ctx.email && adminEmails.includes(ctx.email.trim().toLowerCase())) {
    return true;
  }

  return false;
}

export interface AdminContext extends AccountContext {
  isPlatformAdmin: true;
  callerEmail: string;
}

/**
 * Require caller to be an authenticated OPSIYS platform administrator.
 * Throws ForbiddenError if unauthorized.
 */
export async function requirePlatformAdmin(): Promise<AdminContext> {
  const ctx = await getCurrentAccount();

  // Load user email from auth session
  const { data: userData } = await ctx.supabase.auth.getUser();
  const authUser = userData.user;
  const email = authUser?.email || ctx.userEmail || null;

  // Ensure email confirmation if email provider was used in production
  if (
    authUser &&
    authUser.app_metadata?.provider === 'email' &&
    !authUser.email_confirmed_at &&
    !authUser.confirmed_at &&
    process.env.NODE_ENV === 'production'
  ) {
    throw new ForbiddenError('Administrator email address must be verified.');
  }

  const allowed = isPlatformAdmin({
    accountId: ctx.accountId,
    email,
    role: ctx.role,
  });

  if (!allowed) {
    console.warn('[requirePlatformAdmin] Access restricted for:', {
      accountId: ctx.accountId,
      email,
      role: ctx.role,
      expectedAdmins: process.env.PLATFORM_ADMIN_EMAILS,
      expectedOpsiysAccount: process.env.OPSIYS_ACCOUNT_ID,
    });
    throw new ForbiddenError('Access restricted to authorized platform administrators.');
  }

  return {
    ...ctx,
    isPlatformAdmin: true,
    callerEmail: email || 'unknown',
  };
}
