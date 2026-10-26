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
    vi.spyOn(metaApi, 'registerPhoneNumber').mockResolvedValue({ success: true, alreadyRegistered: true });
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

  describe('permission validation (scopes and granular_scopes)', () => {
    it('connects successfully when both required permissions are in regular scopes (empty granular_scopes)', async () => {
      setupAuthMock('admin');

      vi.spyOn(metaApi, 'exchangeOAuthCode').mockResolvedValue({
        accessToken: 'EAAB_user_token_123',
        tokenType: 'bearer',
      });
      vi.spyOn(metaApi, 'debugToken').mockResolvedValue({
        isValid: true,
        expiresAt: 0,
        scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
        granularScopes: [],
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
          code: 'valid_code',
          waba_id: '99912345678',
          phone_number_id: '11112345678',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('connects successfully when both required permissions are ONLY in granular_scopes (Facebook Login for Business)', async () => {
      setupAuthMock('admin');

      vi.spyOn(metaApi, 'exchangeOAuthCode').mockResolvedValue({
        accessToken: 'EAAB_user_token_123',
        tokenType: 'bearer',
      });
      vi.spyOn(metaApi, 'debugToken').mockResolvedValue({
        isValid: true,
        expiresAt: 0,
        scopes: ['business_management', 'public_profile'], // WhatsApp scopes NOT in scopes
        granularScopes: [
          { scope: 'whatsapp_business_management', targetIds: ['99912345678'] },
          { scope: 'whatsapp_business_messaging', targetIds: ['99912345678'] },
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
          code: 'valid_code',
          waba_id: '99912345678',
          phone_number_id: '11112345678',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('returns 400 when whatsapp_business_management is missing from both scopes and granular_scopes', async () => {
      setupAuthMock('admin');

      vi.spyOn(metaApi, 'exchangeOAuthCode').mockResolvedValue({
        accessToken: 'token_123',
        tokenType: 'bearer',
      });
      vi.spyOn(metaApi, 'debugToken').mockResolvedValue({
        isValid: true,
        scopes: ['business_management'],
        granularScopes: [
          { scope: 'whatsapp_business_messaging', targetIds: ['waba_999'] },
        ],
      });

      const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'code_missing_mgmt',
          waba_id: 'waba_999',
          phone_number_id: 'phone_111',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toMatch(/whatsapp_business_management/);
      expect(json.missing_scopes).toEqual(['whatsapp_business_management']);
    });

    it('returns 400 when whatsapp_business_messaging is missing from both scopes and granular_scopes', async () => {
      setupAuthMock('admin');

      vi.spyOn(metaApi, 'exchangeOAuthCode').mockResolvedValue({
        accessToken: 'token_123',
        tokenType: 'bearer',
      });
      vi.spyOn(metaApi, 'debugToken').mockResolvedValue({
        isValid: true,
        scopes: ['business_management'],
        granularScopes: [
          { scope: 'whatsapp_business_management', targetIds: ['waba_999'] },
        ],
      });

      const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'code_missing_msg',
          waba_id: 'waba_999',
          phone_number_id: 'phone_111',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toMatch(/whatsapp_business_messaging/);
      expect(json.missing_scopes).toEqual(['whatsapp_business_messaging']);
    });

    it('returns 400 when scope data is completely empty', async () => {
      setupAuthMock('admin');

      vi.spyOn(metaApi, 'exchangeOAuthCode').mockResolvedValue({
        accessToken: 'token_123',
        tokenType: 'bearer',
      });
      vi.spyOn(metaApi, 'debugToken').mockResolvedValue({
        isValid: true,
        scopes: [],
        granularScopes: [],
      });

      const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'code_empty_scopes',
          waba_id: 'waba_999',
          phone_number_id: 'phone_111',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toMatch(/permissions/i);
      expect(json.missing_scopes).toEqual([
        'whatsapp_business_management',
        'whatsapp_business_messaging',
      ]);
    });

    it('returns 400 when granular_scopes is undefined or missing', async () => {
      setupAuthMock('admin');

      vi.spyOn(metaApi, 'exchangeOAuthCode').mockResolvedValue({
        accessToken: 'token_123',
        tokenType: 'bearer',
      });
      vi.spyOn(metaApi, 'debugToken').mockResolvedValue({
        isValid: true,
        scopes: [],
      });

      const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'code_undefined_scopes',
          waba_id: 'waba_999',
          phone_number_id: 'phone_111',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.missing_scopes).toEqual([
        'whatsapp_business_management',
        'whatsapp_business_messaging',
      ]);
    });
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

  it('successfully recovers and connects when frontend does not send waba_id, via discoverWabaAccounts', async () => {
    setupAuthMock('admin');

    vi.spyOn(metaApi, 'exchangeOAuthCode').mockResolvedValue({
      accessToken: 'EAAB_token_discovered',
      tokenType: 'bearer',
    });

    // debugToken has NO targetIds (Meta omitted them because permissions apply globally)
    vi.spyOn(metaApi, 'debugToken').mockResolvedValue({
      isValid: true,
      scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
      granularScopes: [
        { scope: 'whatsapp_business_management', targetIds: [] },
      ],
    });

    vi.spyOn(metaApi, 'discoverWabaAccounts').mockResolvedValue([
      { id: '888000111', name: 'Auto Discovered WABA' },
    ]);

    vi.spyOn(metaApi, 'listWabaPhoneNumbers').mockResolvedValue([
      { id: '777000111', display_phone_number: '+1 555-1234' },
    ]);

    vi.spyOn(metaApi, 'verifyPhoneNumber').mockResolvedValue({
      id: '777000111',
      display_phone_number: '+1 555-1234',
      status: 'CONNECTED',
    });

    vi.spyOn(metaApi, 'subscribeWabaToApp').mockResolvedValue();

    const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'code_without_waba',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.waba_id).toBe('888000111');
    expect(json.phone_number_id).toBe('777000111');
  });

  it('resolves WABA ID when target_ids is located in whatsapp_business_messaging scope', async () => {
    setupAuthMock('admin');

    vi.spyOn(metaApi, 'exchangeOAuthCode').mockResolvedValue({
      accessToken: 'EAAB_token_messaging_target',
      tokenType: 'bearer',
    });

    vi.spyOn(metaApi, 'debugToken').mockResolvedValue({
      isValid: true,
      scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
      granularScopes: [
        { scope: 'whatsapp_business_management', targetIds: [] },
        { scope: 'whatsapp_business_messaging', targetIds: ['666555444'] },
      ],
    });

    vi.spyOn(metaApi, 'listWabaPhoneNumbers').mockResolvedValue([
      { id: '555000111', display_phone_number: '+1 555-9876' },
    ]);

    vi.spyOn(metaApi, 'verifyPhoneNumber').mockResolvedValue({
      id: '555000111',
      display_phone_number: '+1 555-9876',
      status: 'CONNECTED',
    });

    vi.spyOn(metaApi, 'subscribeWabaToApp').mockResolvedValue();

    const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'code_messaging_scope_target',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.waba_id).toBe('666555444');
    expect(json.phone_number_id).toBe('555000111');
  });

  it('matches phone_number_id to correct discovered WABA when multiple WABAs exist', async () => {
    setupAuthMock('admin');

    vi.spyOn(metaApi, 'exchangeOAuthCode').mockResolvedValue({
      accessToken: 'EAAB_multi_waba_token',
      tokenType: 'bearer',
    });

    vi.spyOn(metaApi, 'debugToken').mockResolvedValue({
      isValid: true,
      scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
    });

    vi.spyOn(metaApi, 'discoverWabaAccounts').mockResolvedValue([
      { id: '111111111', name: 'WABA 1' },
      { id: '222222222', name: 'WABA 2' },
    ]);

    vi.spyOn(metaApi, 'listWabaPhoneNumbers').mockImplementation(async ({ wabaId }) => {
      if (wabaId === '111111111') {
        return [{ id: '111222333', display_phone_number: '+1 555-1111' }];
      }
      if (wabaId === '222222222') {
        return [{ id: '222333444', display_phone_number: '+1 555-2222' }];
      }
      return [];
    });

    vi.spyOn(metaApi, 'verifyPhoneNumber').mockResolvedValue({
      id: '222333444',
      display_phone_number: '+1 555-2222',
      status: 'CONNECTED',
    });

    vi.spyOn(metaApi, 'subscribeWabaToApp').mockResolvedValue();

    const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'code_multi_waba',
        phone_number_id: '222333444',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.waba_id).toBe('222222222');
    expect(json.phone_number_id).toBe('222333444');
  });

  it('returns 400 with actionable message when no WABAs can be determined', async () => {
    setupAuthMock('admin');

    vi.spyOn(metaApi, 'exchangeOAuthCode').mockResolvedValue({
      accessToken: 'EAAB_no_waba_token',
      tokenType: 'bearer',
    });

    vi.spyOn(metaApi, 'debugToken').mockResolvedValue({
      isValid: true,
      scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
    });

    vi.spyOn(metaApi, 'discoverWabaAccounts').mockResolvedValue([]);

    const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'code_no_wabas',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toMatch(/determine WhatsApp Business Account ID/i);
  });

  it('returns 409 conflict when phone_number_id is already claimed by another tenant', async () => {
    const dbMock = setupAuthMock('admin', 'account-tenant-2');

    // Simulate phone_number_id is already claimed by account-tenant-1
    dbMock.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'whatsapp_config') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              neq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { account_id: 'account-tenant-1' },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockReturnThis() };
    });

    vi.spyOn(metaApi, 'exchangeOAuthCode').mockResolvedValue({
      accessToken: 'EAAB_dup_token',
      tokenType: 'bearer',
    });

    vi.spyOn(metaApi, 'debugToken').mockResolvedValue({
      isValid: true,
      scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
      granularScopes: [{ scope: 'whatsapp_business_management', targetIds: ['888999111'] }],
    });

    vi.spyOn(metaApi, 'listWabaPhoneNumbers').mockResolvedValue([
      { id: '123456789012345', display_phone_number: '+91 70875 56217' },
    ]);

    const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'code_duplicate_number',
        waba_id: '888999111',
        phone_number_id: '123456789012345',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(409);

    const json = await res.json();
    expect(json.error).toMatch(/already linked to another|connected to another/i);
  });

  it('returns 400 with actionable explanation when selected WABA has no phone numbers (unsupported account type)', async () => {
    setupAuthMock('admin');

    vi.spyOn(metaApi, 'exchangeOAuthCode').mockResolvedValue({
      accessToken: 'EAAB_empty_waba_token',
      tokenType: 'bearer',
    });

    vi.spyOn(metaApi, 'debugToken').mockResolvedValue({
      isValid: true,
      scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
      granularScopes: [{ scope: 'whatsapp_business_management', targetIds: ['444555666'] }],
    });

    vi.spyOn(metaApi, 'listWabaPhoneNumbers').mockResolvedValue([]);

    const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'code_empty_waba',
        waba_id: '444555666',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toMatch(/No phone numbers found under the selected WhatsApp Business Account/i);
    expect(json.error).toMatch(/Unsupported WhatsApp business account type/i);
  });

  it('preserves strict tenant isolation and persists credentials only under authenticated accountId', async () => {
    const dbMock = setupAuthMock('admin', 'tenant-isolated-xyz', 'user-456');

    let insertedRow: Record<string, unknown> | null = null;
    dbMock.from = vi.fn().mockImplementation((table: string) => {
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
          insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
            insertedRow = row;
            return Promise.resolve({ error: null });
          }),
        };
      }
      return { select: vi.fn().mockReturnThis() };
    });

    vi.spyOn(metaApi, 'exchangeOAuthCode').mockResolvedValue({
      accessToken: 'EAAB_tenant_token_abc',
      tokenType: 'bearer',
    });

    vi.spyOn(metaApi, 'debugToken').mockResolvedValue({
      isValid: true,
      scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
      granularScopes: [{ scope: 'whatsapp_business_management', targetIds: ['777111222'] }],
    });

    vi.spyOn(metaApi, 'listWabaPhoneNumbers').mockResolvedValue([
      { id: '999888777', display_phone_number: '+91 88087 05136' },
    ]);

    vi.spyOn(metaApi, 'verifyPhoneNumber').mockResolvedValue({
      id: '999888777',
      display_phone_number: '+91 88087 05136',
      status: 'CONNECTED',
    });

    vi.spyOn(metaApi, 'subscribeWabaToApp').mockResolvedValue();

    const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'code_tenant_isolated',
        waba_id: '777111222',
        phone_number_id: '999888777',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);

    // Verify stored row belongs strictly to tenant-isolated-xyz
    expect(insertedRow).not.toBeNull();
    expect((insertedRow as unknown as Record<string, unknown>)?.account_id).toBe('tenant-isolated-xyz');
    expect((insertedRow as unknown as Record<string, unknown>)?.user_id).toBe('user-456');
    expect((insertedRow as unknown as Record<string, unknown>)?.waba_id).toBe('777111222');
    expect((insertedRow as unknown as Record<string, unknown>)?.phone_number_id).toBe('999888777');
  });

  describe('Registration and Persistence State (Step 2 Security Review)', () => {
    const REG_WABA_ID = '999111222333';
    const REG_PHONE_ID = '111222333444';
    const DIFFERENT_PHONE_ID = '555666777888';

    function setupRegistrationTest(existingRow: Record<string, unknown> | null = null) {
      let savedRow: Record<string, unknown> | null = null;
      let saveType: 'insert' | 'update' | null = null;

      const dbMock = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'whatsapp_config') {
            return {
              select: vi.fn().mockImplementation(() => ({
                eq: vi.fn().mockImplementation(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: existingRow, error: null }),
                  neq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  }),
                })),
              })),
              update: vi.fn().mockImplementation((row: Record<string, unknown>) => {
                savedRow = row;
                saveType = 'update';
                return {
                  eq: vi.fn().mockResolvedValue({ error: null }),
                };
              }),
              insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
                savedRow = row;
                saveType = 'insert';
                return Promise.resolve({ error: null });
              }),
            };
          }
          return { select: vi.fn().mockReturnThis() };
        }),
      };

      vi.mocked(supabaseAdmin).mockReturnValue(dbMock as never);
      vi.spyOn(accountAuth, 'requireRole').mockResolvedValue({
        supabase: dbMock as never,
        accountId: 'account-tenant-reg',
        userId: 'user-reg-1',
        role: 'admin' as never,
        userEmail: 'admin@tenant.com',
        account: {
          id: 'account-tenant-reg',
          name: 'Tenant Reg',
          approval_status: 'approved',
          is_suspended: false,
          status_reason: null,
        },
        approvalStatus: 'approved',
        isPlatformAdmin: false,
      });

      vi.spyOn(metaApi, 'exchangeOAuthCode').mockResolvedValue({
        accessToken: 'EAAB_test_reg_token',
        tokenType: 'bearer',
      });

      vi.spyOn(metaApi, 'debugToken').mockResolvedValue({
        isValid: true,
        scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
        granularScopes: [{ scope: 'whatsapp_business_management', targetIds: [REG_WABA_ID] }],
      });

      vi.spyOn(metaApi, 'listWabaPhoneNumbers').mockResolvedValue([
        { id: REG_PHONE_ID, display_phone_number: '+1 555-0100' },
      ]);

      vi.spyOn(metaApi, 'subscribeWabaToApp').mockResolvedValue();

      return {
        getSavedRow: () => savedRow,
        getSaveType: () => saveType,
      };
    }

    it('persists confirmed registration state when Meta confirms phone is CONNECTED', async () => {
      const { getSavedRow } = setupRegistrationTest(null);

      vi.spyOn(metaApi, 'verifyPhoneNumber').mockResolvedValue({
        id: REG_PHONE_ID,
        display_phone_number: '+1 555-0100',
        status: 'CONNECTED',
      });

      const registerSpy = vi.spyOn(metaApi, 'registerPhoneNumber');

      const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'code_connected',
          waba_id: REG_WABA_ID,
          phone_number_id: REG_PHONE_ID,
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.registered).toBe(true);
      expect(json.registration_error).toBeNull();
      expect(registerSpy).not.toHaveBeenCalled();

      const saved = getSavedRow();
      expect(saved?.status).toBe('connected');
      expect(saved?.registered_at).toBeDefined();
      expect(saved?.registered_at).not.toBeNull();
      expect(saved?.last_registration_error).toBeNull();
    });

    it('persists confirmed registration when phone is not CONNECTED but PIN-less register succeeds', async () => {
      const { getSavedRow } = setupRegistrationTest(null);

      vi.spyOn(metaApi, 'verifyPhoneNumber').mockResolvedValue({
        id: REG_PHONE_ID,
        display_phone_number: '+1 555-0100',
        status: 'DISCONNECTED',
      });

      const registerSpy = vi.spyOn(metaApi, 'registerPhoneNumber').mockResolvedValue({
        success: true,
        alreadyRegistered: false,
      });

      const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'code_pinless_success',
          waba_id: REG_WABA_ID,
          phone_number_id: REG_PHONE_ID,
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.registered).toBe(true);
      expect(json.registration_error).toBeNull();
      expect(registerSpy).toHaveBeenCalledWith({
        phoneNumberId: REG_PHONE_ID,
        accessToken: 'EAAB_test_reg_token',
      });

      const saved = getSavedRow();
      expect(saved?.status).toBe('connected');
      expect(saved?.registered_at).toBeDefined();
      expect(saved?.registered_at).not.toBeNull();
      expect(saved?.last_registration_error).toBeNull();
    });

    it('fails registration safely without reporting ready connection when registration requires unavailable PIN (code 133007)', async () => {
      const { getSavedRow } = setupRegistrationTest(null);

      vi.spyOn(metaApi, 'verifyPhoneNumber').mockResolvedValue({
        id: REG_PHONE_ID,
        display_phone_number: '+1 555-0100',
        status: 'DISCONNECTED',
      });

      vi.spyOn(metaApi, 'registerPhoneNumber').mockRejectedValue(
        new metaApi.MetaApiError('Two-step verification PIN required', {
          code: 133007,
          httpStatus: 400,
        })
      );

      const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'code_pin_required',
          waba_id: REG_WABA_ID,
          phone_number_id: REG_PHONE_ID,
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.registered).toBe(false);
      expect(json.registration_error).toMatch(/two-step verification PIN/i);

      const saved = getSavedRow();
      expect(saved?.status).toBe('connected'); // Credentials saved
      expect(saved?.registered_at).toBeNull(); // Not set to a new timestamp
      expect(saved?.last_registration_error).toMatch(/two-step verification PIN/i);
    });

    it('fails registration safely and persists customer-safe error when Meta registration fails with generic error', async () => {
      const { getSavedRow } = setupRegistrationTest(null);

      vi.spyOn(metaApi, 'verifyPhoneNumber').mockResolvedValue({
        id: REG_PHONE_ID,
        display_phone_number: '+1 555-0100',
        status: 'DISCONNECTED',
      });

      vi.spyOn(metaApi, 'registerPhoneNumber').mockRejectedValue(
        new metaApi.MetaApiError('Temporarily unavailable', {
          code: 131000,
          httpStatus: 500,
        })
      );

      const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'code_meta_500',
          waba_id: REG_WABA_ID,
          phone_number_id: REG_PHONE_ID,
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.registered).toBe(false);
      expect(json.registration_error).toBeTruthy();

      const saved = getSavedRow();
      expect(saved?.status).toBe('connected');
      expect(saved?.registered_at).toBeNull();
      expect(saved?.last_registration_error).toBeTruthy();
    });

    it('handles ambiguous or undefined status and registration timeout safely', async () => {
      const { getSavedRow } = setupRegistrationTest(null);

      vi.spyOn(metaApi, 'verifyPhoneNumber').mockResolvedValue({
        id: REG_PHONE_ID,
        display_phone_number: '+1 555-0100',
        status: undefined,
      });

      vi.spyOn(metaApi, 'registerPhoneNumber').mockRejectedValue(
        new Error('Network request timed out')
      );

      const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'code_timeout',
          waba_id: REG_WABA_ID,
          phone_number_id: REG_PHONE_ID,
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.registered).toBe(false);
      expect(json.registration_error).toContain('Network request timed out');

      const saved = getSavedRow();
      expect(saved?.status).toBe('connected');
      expect(saved?.registered_at).toBeNull();
      expect(saved?.last_registration_error).toContain('Network request timed out');
    });

    it('retry behavior: preserves existing valid registered_at timestamp on same number when Meta reports CONNECTED', async () => {
      const existingTimestamp = '2026-10-20T10:00:00.000Z';
      const { getSavedRow } = setupRegistrationTest({
        id: 'existing-config-id',
        phone_number_id: REG_PHONE_ID,
        registered_at: existingTimestamp,
        verify_token: 'existing_verify_token',
      });

      vi.spyOn(metaApi, 'verifyPhoneNumber').mockResolvedValue({
        id: REG_PHONE_ID,
        display_phone_number: '+1 555-0100',
        status: 'CONNECTED',
      });

      const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'code_retry_same_number',
          waba_id: REG_WABA_ID,
          phone_number_id: REG_PHONE_ID,
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.registered).toBe(true);
      expect(json.registration_error).toBeNull();

      const saved = getSavedRow();
      // Must preserve the existing valid timestamp, not overwrite with now
      expect(saved?.registered_at).toBe(existingTimestamp);
      expect(saved?.last_registration_error).toBeNull();
    });

    it('retry behavior: does not overwrite existing valid registration timestamp with null during an unrelated retry when registration fails', async () => {
      const existingTimestamp = '2026-10-20T10:00:00.000Z';
      const { getSavedRow } = setupRegistrationTest({
        id: 'existing-config-id',
        phone_number_id: REG_PHONE_ID,
        registered_at: existingTimestamp,
        verify_token: 'existing_verify_token',
      });

      vi.spyOn(metaApi, 'verifyPhoneNumber').mockResolvedValue({
        id: REG_PHONE_ID,
        display_phone_number: '+1 555-0100',
        status: 'DISCONNECTED',
      });

      vi.spyOn(metaApi, 'registerPhoneNumber').mockRejectedValue(
        new metaApi.MetaApiError('Two-step verification PIN required', {
          code: 133007,
          httpStatus: 400,
        })
      );

      const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'code_unrelated_retry_failure',
          waba_id: REG_WABA_ID,
          phone_number_id: REG_PHONE_ID,
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.registered).toBe(false);
      expect(json.registration_error).toMatch(/two-step verification PIN/i);

      const saved = getSavedRow();
      // Requirement 6: Do not overwrite an existing valid registration timestamp with null during an unrelated retry
      expect(saved?.registered_at).toBe(existingTimestamp);
      expect(saved?.last_registration_error).toMatch(/two-step verification PIN/i);
    });

    it('retry behavior: does NOT preserve previous registered_at when switching to a different phone number whose registration fails', async () => {
      const oldPhoneTimestamp = '2026-10-20T10:00:00.000Z';
      const { getSavedRow } = setupRegistrationTest({
        id: 'existing-config-id',
        phone_number_id: DIFFERENT_PHONE_ID,
        registered_at: oldPhoneTimestamp,
        verify_token: 'existing_verify_token',
      });

      vi.spyOn(metaApi, 'verifyPhoneNumber').mockResolvedValue({
        id: REG_PHONE_ID,
        display_phone_number: '+1 555-0100',
        status: 'DISCONNECTED',
      });

      vi.spyOn(metaApi, 'registerPhoneNumber').mockRejectedValue(
        new metaApi.MetaApiError('Two-step verification PIN required', {
          code: 133007,
          httpStatus: 400,
        })
      );

      const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'code_switch_number_fail',
          waba_id: REG_WABA_ID,
          phone_number_id: REG_PHONE_ID,
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.registered).toBe(false);

      const saved = getSavedRow();
      expect(saved?.phone_number_id).toBe(REG_PHONE_ID);
      // For the new number, registered_at must be null!
      expect(saved?.registered_at).toBeNull();
      expect(saved?.last_registration_error).toMatch(/two-step verification PIN/i);
    });

    it('retry behavior: clears previous last_registration_error and sets registered_at when retry registration succeeds', async () => {
      const { getSavedRow } = setupRegistrationTest({
        id: 'existing-config-id',
        phone_number_id: REG_PHONE_ID,
        registered_at: null,
        last_registration_error: 'Previous PIN failure',
        verify_token: 'existing_verify_token',
      });

      vi.spyOn(metaApi, 'verifyPhoneNumber').mockResolvedValue({
        id: REG_PHONE_ID,
        display_phone_number: '+1 555-0100',
        status: 'DISCONNECTED',
      });

      vi.spyOn(metaApi, 'registerPhoneNumber').mockResolvedValue({
        success: true,
        alreadyRegistered: false,
      });

      const req = new Request('http://localhost/api/whatsapp/embedded-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'code_retry_success',
          waba_id: REG_WABA_ID,
          phone_number_id: REG_PHONE_ID,
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.registered).toBe(true);
      expect(json.registration_error).toBeNull();

      const saved = getSavedRow();
      expect(saved?.registered_at).toBeDefined();
      expect(saved?.registered_at).not.toBeNull();
      expect(saved?.last_registration_error).toBeNull();
    });
  });
});
