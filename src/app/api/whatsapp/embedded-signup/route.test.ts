import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import * as metaApi from '@/lib/whatsapp/meta-api';
import * as accountAuth from '@/lib/auth/account';
import * as encryption from '@/lib/whatsapp/encryption';
import * as rateLimit from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/flows/admin-client';

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: vi.fn(),
}));

describe('POST /api/whatsapp/embedded-signup', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.META_APP_ID = '1234567890';
    process.env.META_APP_SECRET = 'test_meta_app_secret';
    process.env.ENCRYPTION_KEY = '0000000000000000000000000000000000000000000000000000000000000000';
    rateLimit.__resetRateLimitForTests();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function setupAuthMock(role = 'admin', accountId = 'account-tenant-1', userId = 'user-1') {
    const dbMock = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'whatsapp_config') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                neq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
        };
      }),
    };

    vi.mocked(supabaseAdmin).mockReturnValue(dbMock as never);

    vi.spyOn(accountAuth, 'requireRole').mockResolvedValue({
      supabase: dbMock as never,
      accountId,
      userId,
      role: role as never,
      userEmail: 'admin@tenant.com',
      account: {
        id: accountId,
        name: 'Tenant 1',
        approval_status: 'approved',
        is_suspended: false,
        status_reason: null,
      },
      approvalStatus: 'approved',
      isPlatformAdmin: false,
    });

    return dbMock;
  }

  it('successfully exchanges code and connects WhatsApp Business Account', async () => {
    setupAuthMock('admin');

    vi.spyOn(metaApi, 'exchangeOAuthCode').mockResolvedValue({
      accessToken: 'EAAB_user_token_123',
      tokenType: 'bearer',
      expiresIn: 3600,
    });

    const exchangeLongLivedSpy = vi.spyOn(metaApi, 'exchangeForLongLivedToken').mockResolvedValue({
      accessToken: 'EAAB_long_lived_token_456',
      tokenType: 'bearer',
      expiresIn: 5184000,
    });

    vi.spyOn(metaApi, 'debugToken').mockResolvedValue({
      isValid: true,
      expiresAt: 1740000000, // Short-lived (has expiry)
      scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
      granularScopes: [
        { scope: 'whatsapp_business_management', targetIds: ['99912345678'] },
      ],
    });

    vi.spyOn(metaApi, 'listWabaPhoneNumbers').mockResolvedValue([
      { id: '11112345678', display_phone_number: '+1 555-0199', verified_name: 'Test Business' },
    ]);

    vi.spyOn(metaApi, 'verifyPhoneNumber').mockResolvedValue({
      id: '11112345678',
      display_phone_number: '+1 555-0199',
      verified_name: 'Test Business',
      quality_rating: 'GREEN',
    });

    vi.spyOn(metaApi, 'subscribeWabaToApp').mockResolvedValue();

    const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'valid_meta_auth_code',
        waba_id: '99912345678',
        phone_number_id: '11112345678',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.phone_number_id).toBe('11112345678');
    expect(json.waba_id).toBe('99912345678');
    expect(json.access_token).toBeUndefined(); // Never leaks token!
    expect(exchangeLongLivedSpy).toHaveBeenCalledWith(
      expect.objectContaining({ shortLivedToken: 'EAAB_user_token_123' })
    );
  });

  it('connects with permanent system user token (expiresAt: 0) without exchanging', async () => {
    setupAuthMock('admin');

    vi.spyOn(metaApi, 'exchangeOAuthCode').mockResolvedValue({
      accessToken: 'EAAB_permanent_system_user_token',
      tokenType: 'bearer',
    });

    const exchangeLongLivedSpy = vi.spyOn(metaApi, 'exchangeForLongLivedToken');

    vi.spyOn(metaApi, 'debugToken').mockResolvedValue({
      isValid: true,
      expiresAt: 0, // 0 = permanent / never expires in Meta debug_token
      scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
      granularScopes: [
        { scope: 'whatsapp_business_management', targetIds: ['99912345678'] },
      ],
    });

    vi.spyOn(metaApi, 'listWabaPhoneNumbers').mockResolvedValue([
      { id: '11112345678', display_phone_number: '+1 555-0199' },
    ]);

    vi.spyOn(metaApi, 'verifyPhoneNumber').mockResolvedValue({
      id: '11112345678',
      display_phone_number: '+1 555-0199',
    });

    vi.spyOn(metaApi, 'subscribeWabaToApp').mockResolvedValue();

    const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'valid_permanent_auth_code',
        waba_id: '99912345678',
        phone_number_id: '11112345678',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(exchangeLongLivedSpy).not.toHaveBeenCalled();
  });

  it('returns 400 when code is missing', async () => {
    setupAuthMock('admin');

    const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ waba_id: '123' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toMatch(/authorization code/i);
  });

  it('returns 400 when token lacks required permissions', async () => {
    setupAuthMock('admin');

    vi.spyOn(metaApi, 'exchangeOAuthCode').mockResolvedValue({
      accessToken: 'token_123',
      tokenType: 'bearer',
    });

    vi.spyOn(metaApi, 'debugToken').mockResolvedValue({
      isValid: true,
      scopes: ['whatsapp_business_messaging'], // missing whatsapp_business_management!
    });

    const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'code_missing_permissions',
        waba_id: 'waba_999',
        phone_number_id: 'phone_111',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toMatch(/permissions/i);
    expect(json.missing_scopes).toContain('whatsapp_business_management');
  });

  it('returns 409 Conflict when phone number is already claimed by another tenant', async () => {
    // Setup dbMock where maybeSingle returns another account
    const dbMock = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'whatsapp_config') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                neq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { account_id: 'other-tenant-account' },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      }),
    };

    vi.spyOn(accountAuth, 'requireRole').mockResolvedValue({
      supabase: dbMock as never,
      accountId: 'my-tenant-account',
      userId: 'user-1',
      role: 'admin',
      userEmail: 'admin@tenant.com',
      account: {
        id: 'my-tenant-account',
        name: 'Tenant 1',
        approval_status: 'approved',
        is_suspended: false,
        status_reason: null,
      },
      approvalStatus: 'approved',
      isPlatformAdmin: false,
    });

    vi.mocked(supabaseAdmin).mockReturnValue(dbMock as never);

    vi.spyOn(metaApi, 'exchangeOAuthCode').mockResolvedValue({
      accessToken: 'token_123',
      tokenType: 'bearer',
    });

    vi.spyOn(metaApi, 'debugToken').mockResolvedValue({
      isValid: true,
      scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
    });

    vi.spyOn(metaApi, 'listWabaPhoneNumbers').mockResolvedValue([
      { id: '11112222333', display_phone_number: '+1 555-0000' },
    ]);

    const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'code_123',
        waba_id: '99998888777',
        phone_number_id: '11112222333',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(409);

    const json = await res.json();
    expect(json.error).toMatch(/already/i);
  });

  it('fails safely with 500 when ENCRYPTION_KEY is invalid', async () => {
    setupAuthMock('admin');

    vi.spyOn(encryption, 'validateEncryptionKey').mockImplementation(() => {
      throw new Error('Invalid encryption key');
    });

    const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'some_code' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toMatch(/encryption/i);
  });

  it('fails safely with 500 when server Meta App credentials are missing', async () => {
    setupAuthMock('admin');
    delete process.env.META_APP_ID;
    delete process.env.NEXT_PUBLIC_META_APP_ID;

    const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'some_code' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toMatch(/credentials/i);
  });

  it('rejects unauthorized requests with 401', async () => {
    vi.spyOn(accountAuth, 'requireRole').mockRejectedValue(
      new accountAuth.UnauthorizedError()
    );

    const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'valid_code' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('rejects non-admin members with 403', async () => {
    vi.spyOn(accountAuth, 'requireRole').mockRejectedValue(
      new accountAuth.ForbiddenError('Admin role required')
    );

    const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'valid_code' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});
