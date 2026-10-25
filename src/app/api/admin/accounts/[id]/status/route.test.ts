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

describe('POST /api/admin/accounts/[id]/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.requirePlatformAdmin.mockResolvedValue({
      userId: 'admin-uuid-1',
      callerEmail: 'adityaofficial9918@gmail.com',
      isPlatformAdmin: true,
      isPlatformOwner: true,
      accountId: 'opsiys-platform',
    });

    mocks.isProtectedOwnerAccount.mockResolvedValue({
      isProtected: false,
      ownerEmail: null,
    });

    mocks.singleMock = vi.fn().mockResolvedValue({
      data: {
        id: 'acc-tenant-1',
        name: 'Acme Corp',
        approval_status: 'approved',
        is_suspended: false,
        owner_user_id: 'user-tenant-1',
      },
      error: null,
    });

    mocks.selectMock = vi.fn(() => ({
      eq: mocks.eqMock,
      single: mocks.singleMock,
      maybeSingle: vi.fn().mockResolvedValue({
        data: { email: 'client@acme.com', user_id: 'user-tenant-1' },
        error: null,
      }),
    }));

    mocks.eqMock = vi.fn(() => ({
      select: mocks.selectMock,
      single: mocks.singleMock,
      maybeSingle: vi.fn().mockResolvedValue({
        data: { email: 'client@acme.com', user_id: 'user-tenant-1' },
        error: null,
      }),
      eq: mocks.eqMock,
    }));

    mocks.updateMock = vi.fn(() => ({
      eq: mocks.eqMock,
    }));

    mocks.insertMock = vi.fn().mockResolvedValue({ data: null, error: null });

    mocks.supabaseAdmin.mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'accounts') {
          return {
            select: mocks.selectMock,
            update: mocks.updateMock,
          };
        }
        if (table === 'profiles') {
          return {
            select: mocks.selectMock,
            update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) })),
          };
        }
        if (table === 'admin_audit_logs') {
          return {
            insert: mocks.insertMock,
          };
        }
        return {};
      }),
    });
  });

  it('rejects with 403 when caller is not a platform administrator', async () => {
    mocks.requirePlatformAdmin.mockRejectedValueOnce(new ForbiddenError('Forbidden'));

    const req = new Request('http://localhost/api/admin/accounts/acc-1/status', {
      method: 'POST',
      body: JSON.stringify({ action: 'suspend' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'acc-1' }) });
    expect(res.status).toBe(403);
  });

  it('rejects invalid actions with 400', async () => {
    const req = new Request('http://localhost/api/admin/accounts/acc-tenant-1/status', {
      method: 'POST',
      body: JSON.stringify({ action: 'invalid_action' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'acc-tenant-1' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid action');
  });

  it('prevents suspending the permanent Platform Owner account with 403 Forbidden', async () => {
    mocks.isProtectedOwnerAccount.mockResolvedValueOnce({
      isProtected: true,
      ownerEmail: 'adityaofficial9918@gmail.com',
      ownerUserId: 'owner-uuid-1',
    });

    const req = new Request('http://localhost/api/admin/accounts/owner-acc/status', {
      method: 'POST',
      body: JSON.stringify({ action: 'suspend', reason: 'Testing suspension' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'owner-acc' }) });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Cannot suspend or reject the permanent Platform Owner account');
    expect(mocks.updateMock).not.toHaveBeenCalled();
  });

  it('prevents rejecting the permanent Platform Owner account with 403 Forbidden', async () => {
    mocks.isProtectedOwnerAccount.mockResolvedValueOnce({
      isProtected: true,
      ownerEmail: 'adityaofficial9918@gmail.com',
      ownerUserId: 'owner-uuid-1',
    });

    const req = new Request('http://localhost/api/admin/accounts/owner-acc/status', {
      method: 'POST',
      body: JSON.stringify({ action: 'reject', reason: 'Attempted rejection' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'owner-acc' }) });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Cannot suspend or reject the permanent Platform Owner account');
    expect(mocks.updateMock).not.toHaveBeenCalled();
  });

  it('allows reactivating the Platform Owner account (safe recovery)', async () => {
    mocks.isProtectedOwnerAccount.mockResolvedValueOnce({
      isProtected: true,
      ownerEmail: 'adityaofficial9918@gmail.com',
      ownerUserId: 'owner-uuid-1',
    });

    const req = new Request('http://localhost/api/admin/accounts/owner-acc/status', {
      method: 'POST',
      body: JSON.stringify({ action: 'reactivate', reason: 'Owner recovery' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'owner-acc' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.action).toBe('account.reactivated');
    expect(mocks.updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        approval_status: 'approved',
        is_suspended: false,
      })
    );
  });

  it('allows approving, suspending, and reactivating normal tenant accounts', async () => {
    // Normal tenant suspend
    const suspendReq = new Request('http://localhost/api/admin/accounts/acc-tenant-1/status', {
      method: 'POST',
      body: JSON.stringify({ action: 'suspend', reason: 'Billing overdue' }),
    });

    const suspendRes = await POST(suspendReq, { params: Promise.resolve({ id: 'acc-tenant-1' }) });
    expect(suspendRes.status).toBe(200);
    expect(mocks.updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        approval_status: 'suspended',
        is_suspended: true,
        status_reason: 'Billing overdue',
      })
    );

    // Normal tenant reactivate
    const reactivateReq = new Request('http://localhost/api/admin/accounts/acc-tenant-1/status', {
      method: 'POST',
      body: JSON.stringify({ action: 'reactivate', reason: 'Payment received' }),
    });

    const reactivateRes = await POST(reactivateReq, { params: Promise.resolve({ id: 'acc-tenant-1' }) });
    expect(reactivateRes.status).toBe(200);
    expect(mocks.updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        approval_status: 'approved',
        is_suspended: false,
      })
    );
  });
});
