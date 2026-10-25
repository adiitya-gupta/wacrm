import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '@/lib/auth/account';

const mocks = vi.hoisted(() => ({
  requirePlatformAdmin: vi.fn(),
  supabaseAdmin: vi.fn(),
  generateLink: vi.fn(),
  getUserById: vi.fn(),
  insertAudit: vi.fn(),
}));

vi.mock('@/lib/admin/auth', () => ({
  requirePlatformAdmin: mocks.requirePlatformAdmin,
}));

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}));

import { POST } from './route';

describe('POST /api/admin/accounts/[id]/reset-password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects with 403 when caller is not a platform administrator', async () => {
    mocks.requirePlatformAdmin.mockRejectedValue(new ForbiddenError('Forbidden'));

    const req = new Request('http://localhost:3000/api/admin/accounts/acc_1/reset-password', {
      method: 'POST',
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'acc_1' }) });
    expect(res.status).toBe(403);
  });

  it('returns 404 when target account does not exist', async () => {
    mocks.requirePlatformAdmin.mockResolvedValue({
      userId: 'admin_user_1',
      callerEmail: 'adityaofficial9918@gmail.com',
      accountId: 'opsiys_platform',
    });

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'accounts') {
        return {
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
            }),
          }),
        };
      }
      return {};
    });

    mocks.supabaseAdmin.mockReturnValue({ from: fromMock });

    const req = new Request('http://localhost:3000/api/admin/accounts/acc_nonexistent/reset-password', {
      method: 'POST',
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'acc_nonexistent' }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('Client account not found');
  });

  it('returns 400 when account exists but no associated email can be resolved', async () => {
    mocks.requirePlatformAdmin.mockResolvedValue({
      userId: 'admin_user_1',
      callerEmail: 'adityaofficial9918@gmail.com',
      accountId: 'opsiys_platform',
    });

    const createChain = (resolvedData: unknown = null) => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.not = vi.fn().mockReturnValue(chain);
      chain.limit = vi.fn().mockReturnValue(chain);
      chain.single = vi.fn().mockResolvedValue({ data: resolvedData, error: null });
      chain.maybeSingle = vi.fn().mockResolvedValue({ data: resolvedData, error: null });
      return chain;
    };

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'accounts') {
        return createChain({ id: 'acc_empty', name: 'Empty Corp', owner_user_id: null });
      }
      if (table === 'profiles') {
        return createChain(null);
      }
      return createChain(null);
    });

    mocks.supabaseAdmin.mockReturnValue({ from: fromMock });

    const req = new Request('http://localhost:3000/api/admin/accounts/acc_empty/reset-password', {
      method: 'POST',
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'acc_empty' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('No user email found');
  });

  it('generates recovery link and audits event for authorized platform admin', async () => {
    mocks.requirePlatformAdmin.mockResolvedValue({
      userId: 'admin_user_1',
      callerEmail: 'adityaofficial9918@gmail.com',
      accountId: 'opsiys_platform',
    });

    mocks.generateLink.mockResolvedValue({
      data: {
        properties: {
          action_link: 'https://test.supabase.co/auth/v1/verify?token=recovery_token_xyz&type=recovery',
        },
      },
      error: null,
    });

    mocks.insertAudit.mockResolvedValue({ error: null });

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'accounts') {
        return {
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'acc_123', name: 'Acme Corp', owner_user_id: 'user_acme' },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { email: 'client@acme.com', user_id: 'user_acme' },
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'admin_audit_logs') {
        return {
          insert: mocks.insertAudit,
        };
      }
      return {};
    });

    mocks.supabaseAdmin.mockReturnValue({
      from: fromMock,
      auth: {
        admin: {
          generateLink: mocks.generateLink,
          getUserById: mocks.getUserById,
        },
      },
    });

    const req = new Request('http://localhost:3000/api/admin/accounts/acc_123/reset-password', {
      method: 'POST',
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'acc_123' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.email).toBe('client@acme.com');
    expect(body.reset_link).toContain('token=recovery_token_xyz');
    expect(body.reset_url).toContain('token=recovery_token_xyz');

    expect(mocks.generateLink).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'recovery',
        email: 'client@acme.com',
        options: expect.objectContaining({
          redirectTo: expect.stringMatching(/\/auth\/callback\?next=%2Freset-password$/),
        }),
      })
    );
    expect(mocks.insertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'account.password_reset_initiated',
        target_account_id: 'acc_123',
        target_email: 'client@acme.com',
      })
    );
  });

  it('uses canonical production URL for redirectTo when NEXT_PUBLIC_SITE_URL is set', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://wattomation-by-opsiys-lhmn.vercel.app';

    mocks.requirePlatformAdmin.mockResolvedValue({
      userId: 'admin_user_1',
      callerEmail: 'adityaofficial9918@gmail.com',
      accountId: 'opsiys_platform',
    });

    mocks.generateLink.mockResolvedValue({
      data: {
        properties: {
          action_link: 'https://test.supabase.co/auth/v1/verify?token=recovery_token_xyz',
        },
      },
      error: null,
    });

    mocks.getUserById.mockResolvedValue({
      data: { user: { id: 'user_acme', email: 'client@acme.com' } },
      error: null,
    });

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'accounts') {
        return {
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'acc_123', name: 'Acme Corp', owner_user_id: 'user_acme' },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { email: 'client@acme.com', user_id: 'user_acme' },
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'admin_audit_logs') {
        return { insert: mocks.insertAudit };
      }
      return {};
    });

    mocks.supabaseAdmin.mockReturnValue({
      from: fromMock,
      auth: {
        admin: {
          generateLink: mocks.generateLink,
          getUserById: mocks.getUserById,
        },
      },
    });

    const req = new Request('http://localhost:3000/api/admin/accounts/acc_123/reset-password', {
      method: 'POST',
      headers: { host: 'localhost:3000' },
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'acc_123' }) });
    expect(res.status).toBe(200);

    expect(mocks.generateLink).toHaveBeenCalledWith(
      expect.objectContaining({
        options: {
          redirectTo:
            'https://wattomation-by-opsiys-lhmn.vercel.app/auth/callback?next=%2Freset-password',
        },
      })
    );

    delete process.env.NEXT_PUBLIC_SITE_URL;
  });
});
