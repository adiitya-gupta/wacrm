import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((err) =>
    Response.json({ error: (err as Error).message }, { status: 500 })
  ),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitResponse: vi.fn(() =>
    Response.json({ error: 'Rate limit exceeded' }, { status: 429 })
  ),
  RATE_LIMITS: { adminAction: { limit: 30, windowMs: 60000 } },
}));

import { GET, POST } from './route';

const mockContext = {
  supabase: {
    from: mocks.from,
  },
  accountId: 'acc-123',
  userId: 'user-admin',
  role: 'admin',
  account: { id: 'acc-123', name: 'Test Account' },
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.ALLOWED_INVITE_HOSTS;

  mocks.requireRole.mockResolvedValue(mockContext);
  mocks.checkRateLimit.mockResolvedValue({ success: true });

  mocks.single.mockResolvedValue({
    data: {
      id: 'inv-1',
      role: 'agent',
      label: 'New Agent',
      expires_at: '2026-10-27T00:00:00.000Z',
      created_at: '2026-10-20T00:00:00.000Z',
    },
    error: null,
  });

  const queryChain: Record<string, unknown> = {};
  queryChain.single = mocks.single;
  queryChain.eq = vi.fn().mockReturnValue(queryChain);
  queryChain.is = vi.fn().mockReturnValue(queryChain);
  queryChain.gt = vi.fn().mockReturnValue(queryChain);
  queryChain.order = vi.fn().mockResolvedValue({
    data: [{ id: 'inv-1', role: 'agent' }],
    error: null,
  });

  mocks.select.mockReturnValue(queryChain);

  mocks.insert.mockReturnValue({
    select: mocks.select,
  });

  mocks.from.mockReturnValue({
    insert: mocks.insert,
    select: mocks.select,
  });
});

describe('POST /api/account/invitations', () => {
  it('creates an invitation successfully when base URL is resolved via request headers', async () => {
    const req = new Request('http://localhost/api/account/invitations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-host': 'crm.example.com',
        'x-forwarded-proto': 'https',
      },
      body: JSON.stringify({ role: 'agent', label: 'Support Team' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.invitation).toBeDefined();
    expect(body.url).toMatch(/^https:\/\/crm\.example\.com\/join\//);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it('uses configured NEXT_PUBLIC_SITE_URL over request headers', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://portal.mycompany.com';

    const req = new Request('http://localhost/api/account/invitations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-host': 'different.host.com',
        'x-forwarded-proto': 'https',
      },
      body: JSON.stringify({ role: 'agent' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.url).toMatch(/^https:\/\/portal\.mycompany\.com\/join\//);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it('fails safely with 500 and prevents DB insert when host is rejected by allowlist', async () => {
    process.env.ALLOWED_INVITE_HOSTS = 'canonical.domain.com';

    // Request with untrusted / non-allowlisted host
    const req = new Request('http://localhost/api/account/invitations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-host': 'attacker-phishing.com',
        'x-forwarded-proto': 'https',
      },
      body: JSON.stringify({ role: 'agent' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
    // Crucial check: verify that no database record was inserted
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('fails safely with 500 and prevents DB insert when configuration and request host are missing', async () => {
    const req = new Request('http://localhost/api/account/invitations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'agent' }),
    });
    req.headers.delete('host');
    req.headers.delete('x-forwarded-host');

    const res = await POST(req);
    // If request has no valid host and no NEXT_PUBLIC_SITE_URL, must fail safely
    if (!req.headers.get('host')) {
      expect(res.status).toBe(500);
      expect(mocks.insert).not.toHaveBeenCalled();
    }
  });

  it('fails safely with 500 and prevents DB insert when request host is malformed', async () => {
    const req = new Request('http://localhost/api/account/invitations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        host: 'evil.com/path-injection',
      },
      body: JSON.stringify({ role: 'agent' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('rejects invalid roles with 400', async () => {
    const req = new Request('http://localhost/api/account/invitations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        host: 'localhost:3000',
      },
      body: JSON.stringify({ role: 'owner' }), // Owner cannot be invited directly
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('rejects oversized labels with 400', async () => {
    const req = new Request('http://localhost/api/account/invitations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        host: 'localhost:3000',
      },
      body: JSON.stringify({ role: 'agent', label: 'a'.repeat(81) }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});

describe('GET /api/account/invitations', () => {
  it('returns invitations list for authorized admin', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.invitations)).toBe(true);
  });
});
