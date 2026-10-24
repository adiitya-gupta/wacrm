import { describe, expect, it } from 'vitest';
import { isPlatformAdmin } from './auth';

describe('Platform Admin Authorization Guard', () => {
  it('recognizes official OPSIYS account owner/admin as platform admin', () => {
    const originalOpsiysId = process.env.OPSIYS_ACCOUNT_ID;
    try {
      process.env.OPSIYS_ACCOUNT_ID = '00000000-0000-0000-0000-000000000001';

      expect(
        isPlatformAdmin({
          accountId: '00000000-0000-0000-0000-000000000001',
          role: 'owner',
        })
      ).toBe(true);

      expect(
        isPlatformAdmin({
          accountId: '00000000-0000-0000-0000-000000000001',
          role: 'admin',
        })
      ).toBe(true);

      // Viewer in OPSIYS account is NOT a platform admin
      expect(
        isPlatformAdmin({
          accountId: '00000000-0000-0000-0000-000000000001',
          role: 'viewer',
        })
      ).toBe(false);

      // Different account is NOT a platform admin
      expect(
        isPlatformAdmin({
          accountId: 'different-account-id',
          role: 'owner',
        })
      ).toBe(false);
    } finally {
      process.env.OPSIYS_ACCOUNT_ID = originalOpsiysId;
    }
  });

  it('recognizes configured PLATFORM_ADMIN_EMAILS as platform admin regardless of current workspace', () => {
    const originalAdminEmails = process.env.PLATFORM_ADMIN_EMAILS;
    try {
      process.env.PLATFORM_ADMIN_EMAILS = 'opsiys-admin@opsiys.com, ceo@opsiys.com';

      expect(
        isPlatformAdmin({
          accountId: 'any-account-id',
          email: 'opsiys-admin@opsiys.com',
          role: 'viewer',
        })
      ).toBe(true);

      expect(
        isPlatformAdmin({
          accountId: 'any-account-id',
          email: 'random-client@example.com',
          role: 'owner',
        })
      ).toBe(false);
    } finally {
      process.env.PLATFORM_ADMIN_EMAILS = originalAdminEmails;
    }
  });

  it('correctly authorizes local session while blocking all unauthorized clients', () => {
    const origOpsiysId = process.env.OPSIYS_ACCOUNT_ID;
    const origEmails = process.env.PLATFORM_ADMIN_EMAILS;
    try {
      process.env.OPSIYS_ACCOUNT_ID = '7498de6d-f333-457d-8545-ef34fdd10c54';
      process.env.PLATFORM_ADMIN_EMAILS = 'adityaofficial9918@gmail.com';

      // The configured account owner is AUTHORIZED
      expect(
        isPlatformAdmin({
          accountId: '7498de6d-f333-457d-8545-ef34fdd10c54',
          email: 'adityaofficial9918@gmail.com',
          role: 'owner',
        })
      ).toBe(true);

      // The configured account admin is AUTHORIZED
      expect(
        isPlatformAdmin({
          accountId: '7498de6d-f333-457d-8545-ef34fdd10c54',
          role: 'admin',
        })
      ).toBe(true);

      // Another client owner must be BLOCKED
      expect(
        isPlatformAdmin({
          accountId: 'client-isolated-account-uuid',
          email: 'client@company.com',
          role: 'owner',
        })
      ).toBe(false);

      // Another client admin must be BLOCKED
      expect(
        isPlatformAdmin({
          accountId: 'client-isolated-account-uuid',
          email: 'client-admin@company.com',
          role: 'admin',
        })
      ).toBe(false);
    } finally {
      process.env.OPSIYS_ACCOUNT_ID = origOpsiysId;
      process.env.PLATFORM_ADMIN_EMAILS = origEmails;
    }
  });

  it('supports environment variable aliases like ADMIN_EMAILS and PLATFORM_OWNER_EMAIL', () => {
    const origPlatform = process.env.PLATFORM_ADMIN_EMAILS;
    const origAdmin = process.env.ADMIN_EMAILS;
    const origOwner = process.env.PLATFORM_OWNER_EMAIL;

    try {
      delete process.env.PLATFORM_ADMIN_EMAILS;
      process.env.ADMIN_EMAILS = 'ops-lead@opsiys.com';
      process.env.PLATFORM_OWNER_EMAIL = 'founder@opsiys.com';

      expect(isPlatformAdmin({ email: 'ops-lead@opsiys.com' })).toBe(true);
      expect(isPlatformAdmin({ email: '  FOUNDER@OPSIYS.COM  ' })).toBe(true);
      expect(isPlatformAdmin({ email: 'intruder@company.com' })).toBe(false);
    } finally {
      process.env.PLATFORM_ADMIN_EMAILS = origPlatform;
      process.env.ADMIN_EMAILS = origAdmin;
      process.env.PLATFORM_OWNER_EMAIL = origOwner;
    }
  });

  it('authorizes canonical designated platform owner adityaofficial9918@gmail.com by default', () => {
    expect(isPlatformAdmin({ email: 'adityaofficial9918@gmail.com' })).toBe(true);
    expect(isPlatformAdmin({ email: '  ADITYAOFFICIAL9918@GMAIL.COM ' })).toBe(true);
  });
});
