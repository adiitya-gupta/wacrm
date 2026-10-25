import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '@/lib/auth/account';

const mocks = vi.hoisted(() => ({
  requirePlatformAdmin: vi.fn(),
  isProtectedOwnerAccount: vi.fn(),
  supabaseAdmin: vi.fn(),
  updateMock: vi.fn(),
  eqMock: vi.fn(),
  selectMock: vi.fn(),
  singleMock: vi.fn(),
  insertMock: vi.fn(),
}));

vi.mock('@/lib/admin/auth', () => ({
  requirePlatformAdmin: mocks.requirePlatformAdmin,
  isProtectedOwnerAccount: mocks.isProtectedOwnerAccount,
}));

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}));

import { POST } from './route';

describe('POST /api/admin/tenants/[id]/suspend', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.requirePlatformAdmin.mockResolvedValue({
      userId: 'admin-uuid-1',
      callerEmail: 'adityaofficial9918@gmail.com',
      isPlatformAdmin: true,
      isPlatformOwner: true,
    });

    mocks.isProtectedOwnerAccount.mockResolvedValue({
      isProtected: false,
    });

    mocks.singleMock = vi.fn().mockResolvedValue({
      data: { id: 'tenant-1', name: 'Tenant Business', is_suspended: true },
      error: null,
    });

    mocks.selectMock = vi.fn(() => ({
      single: mocks.singleMock,
    }));

    mocks.eqMock = vi.fn(() => ({
      select: mocks.selectMock,
      eq: mocks.eqMock,
    }));

    mocks.updateMock = vi.fn(() => ({
      eq: mocks.eqMock,
    }));

    mocks.insertMock = vi.fn().mockResolvedValue({ data: null, error: null });

    mocks.supabaseAdmin.mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'accounts') {
          return { update: mocks.updateMock };
        }
        if (table === 'profiles') {
          return {
            update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) })),
          };
        }
        if (table === 'admin_audit_logs') {
          return { insert: mocks.insertMock };
        }
        return {};
      }),
    });
  });

  it('rejects with 403 when caller is not a platform administrator', async () => {
    mocks.requirePlatformAdmin.mockRejectedValueOnce(new ForbiddenError('Forbidden'));

    const req = new Request('http://localhost/api/admin/tenants/t-1/suspend', {
      method: 'POST',
      body: JSON.stringify({ is_suspended: true }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 't-1' }) });
    expect(res.status).toBe(403);
  });

  it('prevents suspending the permanent Platform Owner tenant account with 403 Forbidden', async () => {
    mocks.isProtectedOwnerAccount.mockResolvedValueOnce({
      isProtected: true,
      ownerEmail: 'adityaofficial9918@gmail.com',
    });

    const req = new Request('http://localhost/api/admin/tenants/owner-tenant/suspend', {
      method: 'POST',
      body: JSON.stringify({ is_suspended: true }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'owner-tenant' }) });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Cannot suspend the permanent Platform Owner account');
    expect(mocks.updateMock).not.toHaveBeenCalled();
  });

  it('allows unsuspending and suspending ordinary tenants', async () => {
    const req = new Request('http://localhost/api/admin/tenants/tenant-1/suspend', {
      method: 'POST',
      body: JSON.stringify({ is_suspended: false, reason: 'Payment cleared' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'tenant-1' }) });
    expect(res.status).toBe(200);
    expect(mocks.updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        is_suspended: false,
        approval_status: 'approved',
      })
    );
  });
});
