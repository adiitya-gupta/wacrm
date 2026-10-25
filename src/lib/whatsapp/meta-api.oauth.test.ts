import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  exchangeOAuthCode,
  exchangeForLongLivedToken,
  debugToken,
  extractTargetIdsFromDebugToken,
  discoverWabaAccounts,
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

  describe('extractTargetIdsFromDebugToken', () => {
    it('extracts numeric target IDs prioritizing whatsapp_business_management', () => {
      const ids = extractTargetIdsFromDebugToken({
        isValid: true,
        scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
        granularScopes: [
          { scope: 'whatsapp_business_messaging', targetIds: ['222333444'] },
          { scope: 'whatsapp_business_management', targetIds: ['111222333'] },
        ],
      });
      expect(ids).toEqual(['111222333', '222333444']);
    });

    it('extracts from messaging scope when management scope has no targets', () => {
      const ids = extractTargetIdsFromDebugToken({
        isValid: true,
        scopes: ['whatsapp_business_messaging'],
        granularScopes: [
          { scope: 'whatsapp_business_messaging', targetIds: ['999888777'] },
        ],
      });
      expect(ids).toEqual(['999888777']);
    });

    it('filters out non-numeric IDs and duplicates', () => {
      const ids = extractTargetIdsFromDebugToken({
        isValid: true,
        scopes: [],
        granularScopes: [
          { scope: 'custom_scope', targetIds: ['12345', 'not_a_number', '12345', '67890'] },
        ],
      });
      expect(ids).toEqual(['12345', '67890']);
    });

    it('returns empty array when granularScopes is empty or missing', () => {
      expect(extractTargetIdsFromDebugToken({ isValid: true, scopes: [] })).toEqual([]);
      expect(extractTargetIdsFromDebugToken({ isValid: true, scopes: [], granularScopes: [] })).toEqual([]);
    });
  });

  describe('discoverWabaAccounts', () => {
    it('discovers WABAs using businessId query', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/123456/client_whatsapp_business_accounts')) {
          return {
            ok: true,
            json: async () => ({
              data: [{ id: '999000111', name: 'Client WABA 1' }],
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({ data: [] }),
        };
      });

      const res = await discoverWabaAccounts({
        accessToken: 'EAAB_token',
        businessId: '123456',
      });

      expect(res.length).toBeGreaterThanOrEqual(1);
      expect(res[0].id).toBe('999000111');
      expect(res[0].name).toBe('Client WABA 1');
    });

    it('discovers WABAs from /me/businesses and their owned edges', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/me/businesses')) {
          return {
            ok: true,
            json: async () => ({
              data: [{ id: '100200300', name: 'Biz One' }],
            }),
          };
        }
        if (url.includes('/100200300/owned_whatsapp_business_accounts')) {
          return {
            ok: true,
            json: async () => ({
              data: [{ id: '888777666', name: 'Owned WABA' }],
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({ data: [] }),
        };
      });

      const res = await discoverWabaAccounts({
        accessToken: 'EAAB_token',
      });

      expect(res.some((a) => a.id === '888777666')).toBe(true);
    });

    it('discovers WABAs from /me field expansion', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/me?fields=')) {
          return {
            ok: true,
            json: async () => ({
              businesses: {
                data: [
                  {
                    id: 'b1',
                    client_whatsapp_business_accounts: {
                      data: [{ id: '555444333', name: 'Expanded WABA' }],
                    },
                  },
                ],
              },
            }),
          };
        }
        return {
          ok: false,
          status: 404,
        };
      });

      const res = await discoverWabaAccounts({
        accessToken: 'EAAB_token',
      });

      expect(res.some((a) => a.id === '555444333')).toBe(true);
    });

    it('discovers WABAs assigned to user using userId and me edges', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/987654321/assigned_whatsapp_business_accounts')) {
          return {
            ok: true,
            json: async () => ({
              data: [{ id: '777888999', name: 'Assigned User WABA' }],
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({ data: [] }),
        };
      });

      const res = await discoverWabaAccounts({
        accessToken: 'EAAB_token',
        userId: '987654321',
      });

      expect(res.some((a) => a.id === '777888999')).toBe(true);
      expect(res.find((a) => a.id === '777888999')?.name).toBe('Assigned User WABA');
    });
  });
});
