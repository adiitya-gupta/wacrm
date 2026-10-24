import {
  getCurrentAccount,
  ForbiddenError,
  UnauthorizedError,
  type AccountContext,
} from '@/lib/auth/account';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';

// Canonical platform owner emails known across migrations and repo configuration
const DESIGNATED_OWNER_EMAILS = [
  'adityaofficial9918@gmail.com',
  'adityaofficial2018@gmail.com',
];

/**
 * Retrieve the set of all authorized platform administrator emails from
 * all supported environment variable aliases and built-in designated owners.
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

  for (const email of DESIGNATED_OWNER_EMAILS) {
    emails.add(email.trim().toLowerCase());
  }

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
 * Evaluates against OPSIYS_ACCOUNT_ID and PLATFORM_ADMIN_EMAILS (including aliases).
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

export interface AdminContext extends AccountContext {
  isPlatformAdmin: true;
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

  // Evaluate platform administrator status
  let allowed = isPlatformAdmin({ email });

  let accountContext: AccountContext | null = null;
  try {
    accountContext = await getCurrentAccount();
    if (!allowed && accountContext) {
      allowed = isPlatformAdmin({
        accountId: accountContext.accountId,
        email,
        role: accountContext.role,
      });
    }
  } catch {
    // If getCurrentAccount throws because of a missing profile or pending tenant account,
    // check database profile directly via admin client to avoid false-negative lockouts.
    if (!allowed) {
      try {
        const db = supabaseAdmin();
        const { data: prof } = await db
          .from('profiles')
          .select('account_id, account_role')
          .eq('user_id', authUser.id)
          .maybeSingle();

        if (prof) {
          allowed = isPlatformAdmin({
            accountId: prof.account_id,
            email,
            role: prof.account_role,
          });
        }
      } catch {
        // Fallback continues
      }
    }
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
    callerEmail: email || 'unknown',
  };
}
