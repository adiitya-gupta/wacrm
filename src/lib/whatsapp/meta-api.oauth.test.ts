import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  exchangeOAuthCode,
  exchangeForLongLivedToken,
  debugToken,
  MetaApiError,
} from './meta-api';

describe('Meta OAuth & Embedded Signup API Helpers', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('exchangeOAuthCode', () => {
    it('successfully exchanges code for an access token', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'EAAB_test_user_token',
          token_type: 'bearer',
          expires_in: 3600,
        }),
      });

      const res = await exchangeOAuthCode({
        code: 'auth_code_123',
        appId: '123456789',
        appSecret: 'test_secret',
      });

      expect(res.accessToken).toBe('EAAB_test_user_token');
      expect(res.tokenType).toBe('bearer');
      expect(res.expiresIn).toBe(3600);

      const calledUrl = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(calledUrl).toContain('client_id=123456789');
      expect(calledUrl).toContain('client_secret=test_secret');
      expect(calledUrl).toContain('code=auth_code_123');
    });

    it('throws MetaApiError when exchange fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            message: 'Invalid authorization code',
            code: 100,
            fbtrace_id: 'trace_123',
          },
        }),
      });

      await expect(
        exchangeOAuthCode({
          code: 'bad_code',
          appId: '123456789',
          appSecret: 'test_secret',
        })
      ).rejects.toThrow(MetaApiError);
    });
  });

  describe('exchangeForLongLivedToken', () => {
    it('successfully exchanges short-lived token for a long-lived token', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'EAAB_long_lived_token',
          token_type: 'bearer',
          expires_in: 5184000,
        }),
      });

      const res = await exchangeForLongLivedToken({
        shortLivedToken: 'short_token',
        appId: '123456789',
        appSecret: 'test_secret',
      });

      expect(res.accessToken).toBe('EAAB_long_lived_token');
      expect(res.expiresIn).toBe(5184000);

      const calledUrl = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(calledUrl).toContain('grant_type=fb_exchange_token');
      expect(calledUrl).toContain('fb_exchange_token=short_token');
    });
  });

  describe('debugToken', () => {
    it('returns parsed debug token data with permissions and target WABAs', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            app_id: '123456789',
            is_valid: true,
            expires_at: 1740000000,
            scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
            granular_scopes: [
              {
                scope: 'whatsapp_business_management',
                target_ids: ['waba_999'],
              },
            ],
            user_id: 'usr_555',
          },
        }),
      });

      const res = await debugToken({
        inputToken: 'token_to_check',
        appId: '123456789',
        appSecret: 'test_secret',
      });

      expect(res.isValid).toBe(true);
      expect(res.scopes).toContain('whatsapp_business_messaging');
      expect(res.scopes).toContain('whatsapp_business_management');
      expect(res.granularScopes?.[0]?.targetIds).toContain('waba_999');
    });

    it('handles invalid token from debug_token', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            is_valid: false,
            error: {
              code: 190,
              message: 'Invalid OAuth access token',
            },
          },
        }),
      });

      const res = await debugToken({
        inputToken: 'invalid_token',
        appId: '123456789',
        appSecret: 'test_secret',
      });

      expect(res.isValid).toBe(false);
      expect(res.error?.code).toBe(190);
    });
  });
});
