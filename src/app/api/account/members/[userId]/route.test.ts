import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '@/lib/auth/account';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  isProtectedOwnerUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((err) => {
    if (err instanceof ForbiddenError) {
      return new Response(JSON.stringify({ error: err.message }), { status: 403 });
    }
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }),
}));

vi.mock('@/lib/admin/auth', () => ({
  isProtectedOwnerUser: mocks.isProtectedOwnerUser,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ success: true }),
  rateLimitResponse: vi.fn(),
  RATE_LIMITS: { adminAction: {} },
}));

import { PATCH, DELETE } from './route';

describe('Account Members API — Platform Owner Protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.requireRole.mockResolvedValue({
      userId: 'workspace-admin-1',
      accountId: 'acc-1',
      role: 'admin',
      supabase: {
        rpc: mocks.rpc,
      },
    });

    mocks.isProtectedOwnerUser.mockResolvedValue({
      isProtected: false,
    });

    mocks.rpc.mockResolvedValue({ data: 'new-acc-id', error: null });
  });

  describe('PATCH /api/account/members/[userId]', () => {
    it('prevents demoting or changing the role of the permanent Platform Owner with 403 Forbidden', async () => {
      mocks.isProtectedOwnerUser.mockResolvedValueOnce({
        isProtected: true,
        email: 'adityaofficial9918@gmail.com',
      });

      const req = new Request('http://localhost/api/account/members/owner-user-id', {
        method: 'PATCH',
        body: JSON.stringify({ role: 'agent' }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ userId: 'owner-user-id' }) });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain('Cannot demote or modify the role of the permanent Platform Owner');
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it('allows changing roles for standard members', async () => {
      const req = new Request('http://localhost/api/account/members/normal-member-1', {
        method: 'PATCH',
        body: JSON.stringify({ role: 'agent' }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ userId: 'normal-member-1' }) });
      expect(res.status).toBe(200);
      expect(mocks.rpc).toHaveBeenCalledWith('set_member_role', {
        p_user_id: 'normal-member-1',
        p_new_role: 'agent',
      });
    });
  });

  describe('DELETE /api/account/members/[userId]', () => {
    it('prevents removing the permanent Platform Owner with 403 Forbidden', async () => {
      mocks.isProtectedOwnerUser.mockResolvedValueOnce({
        isProtected: true,
        email: 'adityaofficial9918@gmail.com',
      });

      const req = new Request('http://localhost/api/account/members/owner-user-id', {
        method: 'DELETE',
      });

      const res = await DELETE(req, { params: Promise.resolve({ userId: 'owner-user-id' }) });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain('Cannot remove the permanent Platform Owner');
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it('allows removing standard members', async () => {
      const req = new Request('http://localhost/api/account/members/normal-member-1', {
        method: 'DELETE',
      });

      const res = await DELETE(req, { params: Promise.resolve({ userId: 'normal-member-1' }) });
      expect(res.status).toBe(200);
      expect(mocks.rpc).toHaveBeenCalledWith('remove_account_member', {
        p_user_id: 'normal-member-1',
      });
    });
  });
});
