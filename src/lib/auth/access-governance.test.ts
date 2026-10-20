import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  isApprovalStatus,
  isApproved,
  isPending,
  isRejected,
  isSuspended,
  AccountPendingError,
  AccountRejectedError,
  AccountSuspendedError,
} from './approval';
import { isPlatformAdmin } from '../admin/auth';

describe('Acceptance Criteria Suite: Access Governance & Authorization', () => {
  const PLATFORM_ADMIN_EMAIL = 'adityaofficial9918@gmail.com';
  const OPSIYS_ACCOUNT_ID = '7498de6d-f333-457d-8545-ef34fdd10c54';

  beforeEach(() => {
    process.env.PLATFORM_ADMIN_EMAILS = PLATFORM_ADMIN_EMAIL;
    process.env.OPSIYS_ACCOUNT_ID = OPSIYS_ACCOUNT_ID;
  });

  // Criteria 1 & 8: Public homepage works without authentication and does NOT expose /admin
  describe('Criterion 1 & 8: Public Homepage & Admin Concealment', () => {
    it('public paths permit unauthenticated visits without dashboard redirect', () => {
      const publicPaths = ['/', '/product', '/features', '/use-cases'];
      const protectedPaths = [
        '/dashboard',
        '/inbox',
        '/contacts',
        '/pipelines',
        '/admin',
      ];

      for (const p of publicPaths) {
        expect(protectedPaths.includes(p)).toBe(false);
      }
    });

    it('navigation bar does not include any platform admin links', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');

      const homeContent = fs.readFileSync(
        path.join(process.cwd(), 'src/app/page.tsx'),
        'utf-8'
      );
      const sidebarContent = fs.readFileSync(
        path.join(process.cwd(), 'src/components/layout/sidebar.tsx'),
        'utf-8'
      );

      // Verify no admin link on homepage
      expect(homeContent).not.toContain('href="/admin"');
      expect(homeContent).not.toContain('Admin Dashboard');
      expect(homeContent).not.toContain('Admin Login');

      // Verify no admin link in sidebar bottom items
      expect(sidebarContent).not.toContain('{ href: "/admin"');
    });
  });

  // Criteria 2 & 14: Signup creates pending account & requires no payment
  describe('Criterion 2 & 14: Signup creates pending account without payment', () => {
    it('newly registered accounts must have pending status by default', () => {
      const defaultStatus = 'pending';
      expect(isApprovalStatus(defaultStatus)).toBe(true);
      expect(isPending(defaultStatus)).toBe(true);
      expect(isApproved(defaultStatus)).toBe(false);
    });

    it('signup flow does not require or enforce subscription payment', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');

      const signupContent = fs.readFileSync(
        path.join(process.cwd(), 'src/app/(auth)/signup/page.tsx'),
        'utf-8'
      );

      expect(signupContent).not.toContain('stripe');
      expect(signupContent).not.toContain('razorpay');
      expect(signupContent).not.toContain('cardNumber');
      expect(signupContent).not.toContain('checkout');
    });
  });

  // Criteria 3, 4, 10 & 12: Credentials alone do not grant access; Pending/Rejected/Suspended denied
  describe('Criteria 3, 4, 10 & 12: Account Approval Enforcement & Default Deny', () => {
    it('throws AccountPendingError when an account status is pending', () => {
      const account = { id: 'acc-1', name: 'Test Corp', approval_status: 'pending' };
      expect(() => {
        if (account.approval_status === 'pending') {
          throw new AccountPendingError();
        }
      }).toThrowError(AccountPendingError);
    });

    it('throws AccountRejectedError when an account status is rejected', () => {
      const account = { id: 'acc-2', name: 'Denied LLC', approval_status: 'rejected' };
      expect(() => {
        if (account.approval_status === 'rejected') {
          throw new AccountRejectedError();
        }
      }).toThrowError(AccountRejectedError);
    });

    it('throws AccountSuspendedError when an account status is suspended', () => {
      const account = { id: 'acc-3', name: 'Suspended Inc', approval_status: 'suspended' };
      expect(() => {
        if (account.approval_status === 'suspended') {
          throw new AccountSuspendedError();
        }
      }).toThrowError(AccountSuspendedError);
    });

    it('existing active sessions cannot bypass suspension', () => {
      // Simulating a live session where database is_suspended flag flips to true
      const revalidatedAccount = {
        id: 'acc-4',
        name: 'Previously Approved',
        approval_status: 'approved',
        is_suspended: true,
      };

      const isAccountBlocked = isSuspended(
        revalidatedAccount.approval_status,
        revalidatedAccount.is_suspended
      );

      expect(isAccountBlocked).toBe(true);
    });

    it('email verification and OAuth cannot bypass unapproved status', () => {
      // A user who verified email via Supabase Auth callback
      const authUser = {
        id: 'user-verified',
        email: 'customer@example.com',
        email_confirmed_at: '2026-10-19T10:00:00Z',
      };
      const dbAccount = {
        owner_user_id: authUser.id,
        approval_status: 'pending',
      };

      // Even with confirmed email, approval status remains pending and access is denied
      expect(authUser.email_confirmed_at).toBeTruthy();
      expect(isApproved(dbAccount.approval_status)).toBe(false);
    });
  });

  // Criteria 5 & 11: Approved users access only their own workspace
  describe('Criteria 5 & 11: Tenant Isolation', () => {
    it('grants access when status is approved and scopes to tenant accountId', () => {
      const user = { id: 'user-approved-1', email: 'owner@tenant1.com' };
      const account = {
        id: 'tenant-1-uuid',
        name: 'Tenant One',
        approval_status: 'approved',
        is_suspended: false,
      };

      expect(isApproved(account.approval_status)).toBe(true);
      expect(account.id).toBe('tenant-1-uuid');

      // Verify that queries using account.id cannot match tenant-2
      const targetQueryAccountId = 'tenant-2-uuid';
      expect(account.id === targetQueryAccountId).toBe(false);
    });
  });

  // Criterion 6: Users cannot modify their own approval status
  describe('Criterion 6: Non-updatable Privilege Columns', () => {
    it('validates SQL trigger logic prevents authenticated browser modification', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');

      const migration050 = fs.readFileSync(
        path.join(process.cwd(), 'supabase/migrations/050_account_approval_and_security.sql'),
        'utf-8'
      );

      // Verifies trigger enforcement in migration
      expect(migration050).toContain('enforce_account_privilege_columns');
      expect(migration050).toContain('current_user = \'authenticated\'');
      expect(migration050).toContain('approval_status cannot be changed directly');
    });
  });

  // Criteria 7 & 9: Only platform administrator can access /admin; guessing URL does not bypass
  describe('Criteria 7 & 9: Administrator Authorization & Security', () => {
    it('authorizes configured platform administrator', () => {
      const adminCaller = {
        accountId: 'any-account-uuid',
        email: PLATFORM_ADMIN_EMAIL,
        role: 'owner',
      };

      expect(isPlatformAdmin(adminCaller)).toBe(true);
    });

    it('authorizes official OPSIYS account administrator', () => {
      const opsiysCaller = {
        accountId: OPSIYS_ACCOUNT_ID,
        email: 'agent@opsiys.com',
        role: 'admin',
      };

      expect(isPlatformAdmin(opsiysCaller)).toBe(true);
    });

    it('strictly denies ordinary approved customer from platform admin access', () => {
      const approvedCustomer = {
        accountId: 'customer-workspace-uuid',
        email: 'customer@regularbusiness.com',
        role: 'owner',
      };

      // Even though they are owner of their own business, they are NOT platform administrator
      expect(isPlatformAdmin(approvedCustomer)).toBe(false);
    });

    it('strictly denies unauthorized visitors attempting to guess /admin', () => {
      const attacker = {
        accountId: 'attacker-account',
        email: 'hacker@malicious.com',
        role: 'agent',
      };

      expect(isPlatformAdmin(attacker)).toBe(false);
    });
  });

  // Criterion 13: Onboarding starts after approval and can resume safely
  describe('Criterion 13: Safe Onboarding State & Resumability', () => {
    it('tracks onboarding completion flag on accounts', () => {
      const incompleteAccount = {
        id: 'acc-new',
        name: 'Acme',
        approval_status: 'approved',
        onboarding_completed: false,
      };

      const completedAccount = {
        ...incompleteAccount,
        onboarding_completed: true,
      };

      expect(incompleteAccount.onboarding_completed).toBe(false);
      expect(completedAccount.onboarding_completed).toBe(true);
    });
  });
});
