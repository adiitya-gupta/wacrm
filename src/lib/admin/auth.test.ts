import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PERMANENT_PLATFORM_OWNER_EMAIL,
  isPermanentPlatformOwner,
  getPlatformAdminEmails,
  isPlatformAdmin,
  isProtectedOwnerAccount,
  isProtectedOwnerUser,
  requirePlatformAdmin,
} from './auth';
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  supabaseAdmin: vi.fn(),
  fromMock: vi.fn(),
  selectMock: vi.fn(),
  eqMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  getUserByIdMock: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mocks.getUser,
    },
  })),
}));

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}));

describe('Platform Owner Identity & Security Verification', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.PLATFORM_ADMIN_EMAILS;
    delete process.env.ADMIN_EMAILS;
    delete process.env.PLATFORM_OWNER_EMAIL;

    mocks.maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });
    mocks.eqMock = vi.fn(() => ({
      maybeSingle: mocks.maybeSingleMock,
      eq: mocks.eqMock,
    }));
    mocks.selectMock = vi.fn(() => ({
      eq: mocks.eqMock,
    }));
    mocks.fromMock = vi.fn(() => ({
      select: mocks.selectMock,
    }));
    mocks.getUserByIdMock = vi.fn().mockResolvedValue({ data: { user: null }, error: null });

    mocks.supabaseAdmin.mockReturnValue({
      from: mocks.fromMock,
      auth: {
        admin: {
          getUserById: mocks.getUserByIdMock,
        },
      },
    });
  });

  describe('isPermanentPlatformOwner', () => {
    it('accurately identifies the sole permanent platform owner email', () => {
      expect(isPermanentPlatformOwner(PERMANENT_PLATFORM_OWNER_EMAIL)).toBe(true);
      expect(isPermanentPlatformOwner('adityaofficial9918@gmail.com')).toBe(true);
    });

    it('handles mixed casing and whitespace safely', () => {
      expect(isPermanentPlatformOwner('  ADITYAOFFICIAL9918@GMAIL.COM  ')).toBe(true);
      expect(isPermanentPlatformOwner('AdityaOfficial9918@Gmail.Com')).toBe(true);
    });

    it('rejects other emails and lookalike malicious domains', () => {
      expect(isPermanentPlatformOwner('adityaofficial9918@attacker.com')).toBe(false);
      expect(isPermanentPlatformOwner('attacker@gmail.com')).toBe(false);
      expect(isPermanentPlatformOwner('adityaofficial2018@gmail.com')).toBe(false);
      expect(isPermanentPlatformOwner('')).toBe(false);
      expect(isPermanentPlatformOwner(null)).toBe(false);
      expect(isPermanentPlatformOwner(undefined)).toBe(false);
    });
  });

  describe('getPlatformAdminEmails', () => {
    it('always includes the permanent platform owner by default', () => {
      const admins = getPlatformAdminEmails();
      expect(admins).toContain('adityaofficial9918@gmail.com');
    });

    it('parses and normalizes configured admin email environment variables', () => {
      process.env.PLATFORM_ADMIN_EMAILS = 'operations@opsiys.com,  support@opsiys.com ';
      const admins = getPlatformAdminEmails();
      expect(admins).toContain('adityaofficial9918@gmail.com');
      expect(admins).toContain('operations@opsiys.com');
      expect(admins).toContain('support@opsiys.com');
    });
  });

  describe('isPlatformAdmin', () => {
    it('authorizes the verified platform owner email', () => {
      expect(isPlatformAdmin({ email: 'adityaofficial9918@gmail.com' })).toBe(true);
      expect(isPlatformAdmin({ email: 'ADITYAOFFICIAL9918@GMAIL.COM' })).toBe(true);
    });

    it('blocks tenant owners claiming platform admin without authorized email', () => {
      expect(
        isPlatformAdmin({
          accountId: 'tenant-1234',
          email: 'tenant.ceo@business.com',
          role: 'owner',
        })
      ).toBe(false);
    });

    it('blocks members with insufficient role in OPSIYS account', () => {
      const opsiysId = '7498de6d-f333-457d-8545-ef34fdd10c54';
      expect(
        isPlatformAdmin({
          accountId: opsiysId,
          email: 'staff@opsiys.com',
          role: 'viewer',
        })
      ).toBe(false);
    });

    it('blocks unauthenticated or empty callers', () => {
      expect(isPlatformAdmin({ email: null })).toBe(false);
      expect(isPlatformAdmin({ email: '' })).toBe(false);
    });
  });

  describe('requirePlatformAdmin', () => {
    it('throws UnauthorizedError when session is missing', async () => {
      mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error('No session') });
      await expect(requirePlatformAdmin()).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when authenticated user is not an authorized admin', async () => {
      mocks.getUser.mockResolvedValueOnce({
        data: {
          user: {
            id: 'tenant-user-1',
            email: 'tenant@client.com',
          },
        },
        error: null,
      });

      await expect(requirePlatformAdmin()).rejects.toThrow(ForbiddenError);
    });

    it('successfully grants AdminContext with isPlatformOwner: true for verified owner', async () => {
      mocks.getUser.mockResolvedValueOnce({
        data: {
          user: {
            id: 'owner-uuid-123',
            email: 'adityaofficial9918@gmail.com',
          },
        },
        error: null,
      });

      const ctx = await requirePlatformAdmin();
      expect(ctx.isPlatformAdmin).toBe(true);
      expect(ctx.isPlatformOwner).toBe(true);
      expect(ctx.userId).toBe('owner-uuid-123');
      expect(ctx.callerEmail).toBe('adityaofficial9918@gmail.com');
    });
  });

  describe('isProtectedOwnerAccount', () => {
    it('identifies designated OPSIYS platform account as protected', async () => {
      const res = await isProtectedOwnerAccount('7498de6d-f333-457d-8545-ef34fdd10c54');
      expect(res.isProtected).toBe(true);
      expect(res.ownerEmail).toBe('adityaofficial9918@gmail.com');
    });

    it('identifies account linked to platform owner profile as protected', async () => {
      const dbMock = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'accounts') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: 'acc-owner-1', owner_user_id: 'user-owner-1' },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === 'profiles') {
            return {
              select: () => ({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    {
                      email: 'adityaofficial9918@gmail.com',
                      user_id: 'user-owner-1',
                      account_role: 'owner',
                    },
                  ],
                  error: null,
                }),
              }),
            };
          }
          return {};
        }),
        auth: { admin: { getUserById: vi.fn() } },
      };

      const res = await isProtectedOwnerAccount('acc-owner-1', dbMock as never);
      expect(res.isProtected).toBe(true);
      expect(res.ownerEmail).toBe('adityaofficial9918@gmail.com');
    });

    it('returns isProtected: false for standard tenant accounts', async () => {
      const dbMock = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'accounts') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: 'acc-tenant-99', owner_user_id: 'user-tenant-99' },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === 'profiles') {
            return {
              select: () => ({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    {
                      email: 'tenant@client.com',
                      user_id: 'user-tenant-99',
                      account_role: 'owner',
                    },
                  ],
                  error: null,
                }),
              }),
            };
          }
          return {};
        }),
        auth: {
          admin: {
            getUserById: vi.fn().mockResolvedValue({
              data: { user: { email: 'tenant@client.com' } },
            }),
          },
        },
      };

      const res = await isProtectedOwnerAccount('acc-tenant-99', dbMock as never);
      expect(res.isProtected).toBe(false);
    });
  });

  describe('isProtectedOwnerUser', () => {
    it('returns isProtected: true when user profile email matches platform owner', async () => {
      const dbMock = {
        from: vi.fn().mockImplementation(() => ({
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { email: 'adityaofficial9918@gmail.com' },
                error: null,
              }),
            }),
          }),
        })),
        auth: { admin: { getUserById: vi.fn() } },
      };

      const res = await isProtectedOwnerUser('user-owner-1', dbMock as never);
      expect(res.isProtected).toBe(true);
      expect(res.email).toBe('adityaofficial9918@gmail.com');
    });

    it('returns isProtected: false for ordinary tenant user', async () => {
      const dbMock = {
        from: vi.fn().mockImplementation(() => ({
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { email: 'agent@client.com' },
                error: null,
              }),
            }),
          }),
        })),
        auth: {
          admin: {
            getUserById: vi.fn().mockResolvedValue({
              data: { user: { email: 'agent@client.com' } },
            }),
          },
        },
      };

      const res = await isProtectedOwnerUser('user-agent-1', dbMock as never);
      expect(res.isProtected).toBe(false);
    });
  });
});
