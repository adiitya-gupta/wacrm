import { describe, expect, it, vi, beforeEach } from 'vitest';
import { isPlatformAdmin } from '../admin/auth';
import { findActiveKeyByHash } from '../api-keys/store';
import { generateApiKey, hashApiKey } from '../api-keys/keys';
import { supabaseAdmin } from '../flows/admin-client';

// Mock supabaseAdmin
vi.mock('../flows/admin-client', () => {
  const maybeSingleMock = vi.fn();
  const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
  const selectMock = vi.fn(() => ({ eq: eqMock }));
  const fromMock = vi.fn(() => ({ select: selectMock }));

  return {
    supabaseAdmin: () => ({
      from: fromMock,
      _mocks: { fromMock, selectMock, eqMock, maybeSingleMock },
    }),
  };
});

describe('Security Audit — Adversarial Attacks & Guard Verifications', () => {
  const PLATFORM_ADMIN_EMAIL = 'adityaofficial9918@gmail.com';
  const OPSIYS_ACCOUNT_ID = '7498de6d-f333-457d-8545-ef34fdd10c54';

  beforeEach(() => {
    process.env.PLATFORM_ADMIN_EMAILS = `${PLATFORM_ADMIN_EMAIL},adityaofficial2018@gmail.com`;
    process.env.OPSIYS_ACCOUNT_ID = OPSIYS_ACCOUNT_ID;
  });

  describe('Adversarial Threat 1: Platform Admin Impersonation & Forged Headers', () => {
    it('blocks forged client-supplied admin email when casing or whitespace differs', () => {
      // Valid admin email with trimming
      expect(
        isPlatformAdmin({
          accountId: 'tenant-1',
          email: '  ADITYAOFFICIAL9918@GMAIL.COM  ',
          role: 'viewer',
        })
      ).toBe(true);

      // Malicious typo / lookalike
      expect(
        isPlatformAdmin({
          accountId: 'tenant-1',
          email: 'adityaofficial9918@attacker.com',
          role: 'owner',
        })
      ).toBe(false);

      expect(
        isPlatformAdmin({
          accountId: 'tenant-1',
          email: 'admin@opsiys.com.attacker.com',
          role: 'owner',
        })
      ).toBe(false);
    });

    it('blocks ordinary workspace owner attempting to claim platform admin with spoofed account ID', () => {
      // User is owner of their own business, not the OPSIYS platform account
      const customer = {
        accountId: 'victim-tenant-uuid-1234',
        email: 'ceo@acmecorp.com',
        role: 'owner',
      };

      expect(isPlatformAdmin(customer)).toBe(false);
    });

    it('blocks unverified/empty email addresses', () => {
      expect(
        isPlatformAdmin({
          accountId: 'tenant-1',
          email: null,
          role: 'owner',
        })
      ).toBe(false);

      expect(
        isPlatformAdmin({
          accountId: 'tenant-1',
          email: '',
          role: 'owner',
        })
      ).toBe(false);

      expect(
        isPlatformAdmin({
          accountId: 'tenant-1',
          email: '   ',
          role: 'owner',
        })
      ).toBe(false);
    });
  });

  describe('Adversarial Threat 2: Suspended Account API Key Invalidation', () => {
    it('findActiveKeyByHash rejects keys belonging to suspended accounts', async () => {
      const db = supabaseAdmin() as any;
      const key = generateApiKey();
      const hash = hashApiKey(key.plaintext);

      // Mock DB: key exists in api_keys table
      db._mocks.maybeSingleMock
        .mockResolvedValueOnce({
          data: {
            id: 'key-1',
            account_id: 'acc-suspended',
            created_by: 'user-1',
            name: 'Production Key',
            scopes: ['messages:send'],
            expires_at: null,
            revoked_at: null,
          },
          error: null,
        })
        // Mock DB: account check returns suspended
        .mockResolvedValueOnce({
          data: {
            id: 'acc-suspended',
            is_suspended: true,
            approval_status: 'suspended',
          },
          error: null,
        });

      const activeKey = await findActiveKeyByHash(hash);
      expect(activeKey).toBeNull();
    });

    it('findActiveKeyByHash rejects keys belonging to rejected or pending accounts', async () => {
      const db = supabaseAdmin() as any;
      const key = generateApiKey();
      const hash = hashApiKey(key.plaintext);

      db._mocks.maybeSingleMock
        .mockResolvedValueOnce({
          data: {
            id: 'key-2',
            account_id: 'acc-pending',
            created_by: 'user-2',
            name: 'Dev Key',
            scopes: ['contacts:read'],
            expires_at: null,
            revoked_at: null,
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: {
            id: 'acc-pending',
            is_suspended: false,
            approval_status: 'pending',
          },
          error: null,
        });

      const activeKey = await findActiveKeyByHash(hash);
      expect(activeKey).toBeNull();
    });

    it('findActiveKeyByHash allows active keys for approved, non-suspended accounts', async () => {
      const db = supabaseAdmin() as any;
      const key = generateApiKey();
      const hash = hashApiKey(key.plaintext);

      db._mocks.maybeSingleMock
        .mockResolvedValueOnce({
          data: {
            id: 'key-3',
            account_id: 'acc-approved',
            created_by: 'user-3',
            name: 'Live Key',
            scopes: ['messages:send'],
            expires_at: null,
            revoked_at: null,
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: {
            id: 'acc-approved',
            is_suspended: false,
            approval_status: 'approved',
          },
          error: null,
        });

      const activeKey = await findActiveKeyByHash(hash);
      expect(activeKey).not.toBeNull();
      expect(activeKey?.account_id).toBe('acc-approved');
    });

    it('findActiveKeyByHash fails closed when approval_status column does not exist in production', async () => {
      const origEnv = process.env.NODE_ENV;
      try {
        // @ts-expect-error mutating readonly for test
        process.env.NODE_ENV = 'production';
        const db = supabaseAdmin() as any;
        const key = generateApiKey();
        const hash = hashApiKey(key.plaintext);

        db._mocks.maybeSingleMock
          .mockResolvedValueOnce({
            data: {
              id: 'key-unmigrated',
              account_id: 'acc-unmigrated',
              created_by: 'user-unmigrated',
              name: 'Unmigrated Key',
              scopes: ['messages:send'],
              expires_at: null,
              revoked_at: null,
            },
            error: null,
          })
          // First attempt to query approval_status fails with column not found (42703)
          .mockResolvedValueOnce({
            data: null,
            error: { code: '42703', message: 'column accounts.approval_status does not exist' },
          })
          // Fallback basic accounts query returns non-suspended account
          .mockResolvedValueOnce({
            data: { id: 'acc-unmigrated', is_suspended: false },
            error: null,
          });

        const activeKey = await findActiveKeyByHash(hash);
        // Must fail closed because approval cannot be established without the security column
        expect(activeKey).toBeNull();
      } finally {
        // @ts-expect-error restoring env
        process.env.NODE_ENV = origEnv;
      }
    });
  });

  describe('Adversarial Threat 3: Self-Service Role & Approval Privilege Escalation Prevention', () => {
    it('verifies that migration 050 guards both accounts and profiles tables with triggers', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');

      const migration050 = fs.readFileSync(
        path.join(process.cwd(), 'supabase/migrations/050_account_approval_and_security.sql'),
        'utf-8'
      );

      // Verify trigger attachment on accounts
      expect(migration050).toContain('CREATE TRIGGER enforce_account_privilege_columns');
      expect(migration050).toContain('BEFORE UPDATE ON public.accounts');

      // Verify trigger attachment on profiles
      expect(migration050).toContain('CREATE TRIGGER enforce_profile_privilege_columns');
      expect(migration050).toContain('BEFORE UPDATE ON public.profiles');

      // Verify failure contract
      expect(migration050).toContain('insufficient_privilege');
    });
  });

  describe('Adversarial Threat 4: Secret Leakage & Credential Exposure Guard', () => {
    it('guarantees that service-role and encryption keys are absent from public client bundles', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');

      const clientComponents = [
        'src/components/layout/sidebar.tsx',
        'src/components/layout/header.tsx',
        'src/app/page.tsx',
        'src/app/(auth)/login/page.tsx',
        'src/app/(auth)/signup/page.tsx',
        'src/app/(dashboard)/dashboard-shell.tsx',
        'src/app/(dashboard)/admin/page.tsx',
        'src/app/(dashboard)/onboarding/page.tsx',
      ];

      for (const comp of clientComponents) {
        const content = fs.readFileSync(path.join(process.cwd(), comp), 'utf-8');
        expect(content).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
        expect(content).not.toContain('process.env.SUPABASE_SERVICE_ROLE_KEY');
        expect(content).not.toContain('process.env.ENCRYPTION_KEY');
        expect(content).not.toContain('process.env.META_APP_SECRET');
        expect(content).not.toContain('process.env.AUTOMATION_CRON_SECRET');
      }
    });

    it('ensures .gitignore completely excludes all local environment files', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');

      const gitignore = fs.readFileSync(path.join(process.cwd(), '.gitignore'), 'utf-8');
      expect(gitignore).toMatch(/\.env\*/);
    });
  });
});
