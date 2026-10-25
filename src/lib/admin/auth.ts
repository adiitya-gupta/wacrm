import {
  getCurrentAccount,
  ForbiddenError,
  UnauthorizedError,
  type AccountContext,
} from '@/lib/auth/account';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';

import { PERMANENT_PLATFORM_OWNER_EMAIL, isPermanentPlatformOwner } from './owner';
export { PERMANENT_PLATFORM_OWNER_EMAIL, isPermanentPlatformOwner };

/**
 * Retrieve the set of all authorized platform administrator emails from
 * all supported environment variable aliases and the canonical platform owner.
 */
export function getPlatformAdminEmails(): string[] {
  const envVars = [
    process.env.PLATFORM_ADMIN_EMAILS,
    process.env.ADMIN_EMAILS,
    process.env.PLATFORM_OWNER_EMAIL,
    process.env.OWNER_EMAIL,
    process.env.ADMIN_EMAIL,
  ];

  const emails = new Set<string>();
  emails.add(PERMANENT_PLATFORM_OWNER_EMAIL.toLowerCase());

  for (const raw of envVars) {
    if (!raw) continue;
    raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
      .forEach((e) => emails.add(e));
  }

  return Array.from(emails);
}

/**
 * Check whether a given account context or email represents an authorized platform administrator.
 * Evaluates against OPSIYS_ACCOUNT_ID (for account owner/admin) and authorized administrator emails.
 */
export function isPlatformAdmin(ctx: {
  accountId?: string | null;
  email?: string | null;
  role?: string | null;
}): boolean {
  const opsiysAccountId =
    process.env.OPSIYS_ACCOUNT_ID?.trim() || '7498de6d-f333-457d-8545-ef34fdd10c54';

  if (ctx.accountId && ctx.accountId === opsiysAccountId) {
    if (ctx.role === 'owner' || ctx.role === 'admin') {
      return true;
    }
  }

  if (ctx.email) {
    const normalized = ctx.email.trim().toLowerCase();
    const adminEmails = getPlatformAdminEmails();
    if (adminEmails.includes(normalized)) {
      return true;
    }
  }

  return false;
}

/**
 * Verify whether a database account belongs to or was provisioned for the permanent Platform Owner.
 */
export async function isProtectedOwnerAccount(
  accountId: string,
  db = supabaseAdmin()
): Promise<{
  isProtected: boolean;
  ownerEmail?: string | null;
  ownerUserId?: string | null;
}> {
  if (!accountId) return { isProtected: false };

  const opsiysAccountId =
    process.env.OPSIYS_ACCOUNT_ID?.trim() || '7498de6d-f333-457d-8545-ef34fdd10c54';

  if (accountId === opsiysAccountId) {
    return {
      isProtected: true,
      ownerEmail: PERMANENT_PLATFORM_OWNER_EMAIL,
    };
  }

  try {
    const { data: account } = await db
      .from('accounts')
      .select('id, owner_user_id')
      .eq('id', accountId)
      .maybeSingle();

    const { data: profiles } = await db
      .from('profiles')
      .select('email, user_id, account_role')
      .eq('account_id', accountId);

    if (profiles && profiles.length > 0) {
      for (const p of profiles) {
        if (p.email && isPermanentPlatformOwner(p.email)) {
          return {
            isProtected: true,
            ownerEmail: p.email,
            ownerUserId: p.user_id,
          };
        }
      }
    }

    if (account?.owner_user_id) {
      const { data: authUser } = await db.auth.admin.getUserById(account.owner_user_id);
      if (authUser?.user?.email && isPermanentPlatformOwner(authUser.user.email)) {
        return {
          isProtected: true,
          ownerEmail: authUser.user.email,
          ownerUserId: account.owner_user_id,
        };
      }
    }
  } catch (err) {
    console.error('[isProtectedOwnerAccount] error inspecting account:', err);
  }

  return { isProtected: false };
}

/**
 * Verify whether a user is the permanent Platform Owner.
 */
export async function isProtectedOwnerUser(
  userId: string,
  db = supabaseAdmin()
): Promise<{
  isProtected: boolean;
  email?: string | null;
}> {
  if (!userId) return { isProtected: false };

  try {
    const { data: profile } = await db
      .from('profiles')
      .select('email')
      .eq('user_id', userId)
      .maybeSingle();

    if (profile?.email && isPermanentPlatformOwner(profile.email)) {
      return { isProtected: true, email: profile.email };
    }

    const { data: authUser } = await db.auth.admin.getUserById(userId);
    if (authUser?.user?.email && isPermanentPlatformOwner(authUser.user.email)) {
      return { isProtected: true, email: authUser.user.email };
    }
  } catch (err) {
    console.error('[isProtectedOwnerUser] error inspecting user:', err);
  }

  return { isProtected: false };
}

export interface AdminContext extends AccountContext {
  isPlatformAdmin: true;
  isPlatformOwner: boolean;
  callerEmail: string;
}

/**
 * Require caller to be an authenticated OPSIYS platform administrator.
 * Decouples platform-level access from regular client-tenant requirements.
 * Throws UnauthorizedError if not signed in, or ForbiddenError if unauthorized.
 */
export async function requirePlatformAdmin(): Promise<AdminContext> {
  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  const authUser = userData?.user;

  if (userErr || !authUser) {
    throw new UnauthorizedError();
  }

  const email = (authUser.email || '').trim().toLowerCase();

  // Evaluate platform administrator status strictly based on verified email
  const allowed = isPlatformAdmin({ email });

  let accountContext: AccountContext | null = null;
  try {
    accountContext = await getCurrentAccount();
  } catch {
    // If getCurrentAccount throws because of an unlinked profile or pending tenant account,
    // platform administrator access remains valid based on verified auth identity.
  }

  if (!allowed) {
    console.warn('[requirePlatformAdmin] Access restricted for:', {
      userId: authUser.id,
      email,
      accountId: accountContext?.accountId,
      role: accountContext?.role,
    });
    throw new ForbiddenError('Access restricted to authorized platform administrators.');
  }

  // If no tenant account was resolved, construct a reliable platform administrator context
  if (!accountContext) {
    const opsiysAccountId =
      process.env.OPSIYS_ACCOUNT_ID?.trim() || '7498de6d-f333-457d-8545-ef34fdd10c54';

    accountContext = {
      supabase,
      userId: authUser.id,
      accountId: opsiysAccountId,
      role: 'owner',
      account: {
        id: opsiysAccountId,
        name: 'OPSIYS Platform Admin',
        approval_status: 'approved',
        is_suspended: false,
        status_reason: null,
      },
      approvalStatus: 'approved',
      isPlatformAdmin: true,
      userEmail: email,
    };
  }

  return {
    ...accountContext,
    isPlatformAdmin: true,
    isPlatformOwner: isPermanentPlatformOwner(email),
    callerEmail: email || 'unknown',
  };
}
