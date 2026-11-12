import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createGoogleOAuthState,
  validateGoogleOAuthState,
  encryptGoogleTokens,
  decryptGoogleTokens,
  getValidAccessToken,
  getValidAccessTokenForAccount,
  disconnectGoogleCalendarForAccount,
  queryGoogleBusyPeriods,
  revokeGoogleToken,
  listGoogleCalendars,
  createGoogleCalendarEvent,
  updateGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
} from './google-calendar';

describe('Multi-Tenant SaaS Google Calendar Integration', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.GOOGLE_CLIENT_ID = 'test-platform-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'test-platform-client-secret';
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.wattomation.com';
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // ============================================================
  // 1. STATE INTEGRITY & ANTI-CSRF / ANTI-ACCOUNT-LINKING
  // ============================================================
  describe('OAuth State Integrity & Anti-Account-Linking Security', () => {
    it('creates an AES-256-GCM tamper-proof state containing tenant accountId, userId, and nonce', () => {
      const tenantA = 'tenant-account-alpha-uuid';
      const userA = 'user-admin-alpha-uuid';

      const { state, nonce } = createGoogleOAuthState({
        accountId: tenantA,
        userId: userA,
      });

      expect(typeof state).toBe('string');
      expect(typeof nonce).toBe('string');
      expect(nonce.length).toBeGreaterThanOrEqual(16);

      const validation = validateGoogleOAuthState(state);
      expect(validation.valid).toBe(true);
      if (validation.valid) {
        expect(validation.payload.accountId).toBe(tenantA);
        expect(validation.payload.userId).toBe(userA);
        expect(validation.payload.nonce).toBe(nonce);
        expect(Date.now() - validation.payload.timestamp).toBeLessThan(5000);
      }
    });

    it('rejects a tampered state string due to AES-256-GCM authentication tag failure', () => {
      const { state } = createGoogleOAuthState({
        accountId: 'tenant-account-alpha-uuid',
        userId: 'user-admin-alpha-uuid',
      });

      const decoded = Buffer.from(state, 'base64url').toString('utf8');
      const parts = decoded.split(':');
      parts[1] = parts[1].slice(0, -2) + (parts[1].endsWith('f') ? '0' : 'f');
      const tampered = Buffer.from(parts.join(':'), 'utf8').toString('base64url');

      const validation = validateGoogleOAuthState(tampered);
      expect(validation.valid).toBe(false);
      if (!validation.valid) {
        expect(validation.error).toBe('INVALID_STATE_CIPHERTEXT');
      }
    });

    it('rejects an expired state (>15 minutes old)', () => {
      const sixteenMinutesAgo = Date.now() - 16 * 60 * 1000;
      const { state } = createGoogleOAuthState({
        accountId: 'tenant-account-alpha-uuid',
        userId: 'user-admin-alpha-uuid',
        timestamp: sixteenMinutesAgo,
      });

      const validation = validateGoogleOAuthState(state);
      expect(validation.valid).toBe(false);
      if (!validation.valid) {
        expect(validation.error).toBe('STATE_EXPIRED');
      }
    });

    it('rejects completely malformed or missing states', () => {
      expect(validateGoogleOAuthState('').valid).toBe(false);
      expect(validateGoogleOAuthState('not-a-valid-base64-or-cipher').valid).toBe(false);
    });
  });

  // ============================================================
  // 2. STANDALONE TOKEN VALIDATION
  // ============================================================
  describe('getValidAccessToken safety', () => {
    it('returns null instead of an expired token when refresh_token is missing or refresh fails', async () => {
      const noRefresh = await getValidAccessToken({
        access_token: 'ya29.expired',
        expiry_date: Date.now() - 10_000,
      });
      expect(noRefresh).toBeNull();

      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
      );
      const failedRefresh = await getValidAccessToken({
        access_token: 'ya29.expired',
        refresh_token: '1//revoked',
        expiry_date: Date.now() - 10_000,
      });
      expect(failedRefresh).toBeNull();
    });
  });

  // ============================================================
  // 3. TWO TENANTS CONNECTING SEPARATE GOOGLE ACCOUNTS
  // ============================================================
  describe('Multi-Tenant Account Isolation (Two Distinct Tenants)', () => {
    const TENANT_A = 'tenant-alpha-1111-1111-1111-111111111111';
    const TENANT_B = 'tenant-beta-2222-2222-2222-222222222222';

    let databaseSettings: Record<string, Record<string, unknown>> = {};

    function createMockDb(): SupabaseClient {
      return {
        from: (table: string) => {
          if (table === 'scheduling_settings') {
            return {
              select: (cols: string) => ({
                eq: (_col: string, val: string) => ({
                  maybeSingle: async () => {
                    const row = databaseSettings[val];
                    if (!row) return { data: null, error: null };
                    const result: Record<string, unknown> = {};
                    cols.split(',').map((c) => c.trim()).forEach((c) => {
                      result[c] = row[c];
                    });
                    return { data: result, error: null };
                  },
                }),
              }),
              update: (updates: Record<string, unknown>) => ({
                eq: (_col: string, val: string) => {
                  if (databaseSettings[val]) {
                    databaseSettings[val] = { ...databaseSettings[val], ...updates };
                  }
                  return Promise.resolve({ data: databaseSettings[val], error: null });
                },
              }),
              insert: (record: Record<string, unknown> & { account_id: string }) => {
                databaseSettings[record.account_id] = { ...record };
                return Promise.resolve({ data: record, error: null });
              },
            };
          }
          throw new Error(`Unexpected table ${table}`);
        },
      } as unknown as SupabaseClient;
    }

    beforeEach(() => {
      databaseSettings = {
        [TENANT_A]: {
          account_id: TENANT_A,
          google_calendar_enabled: true,
          google_calendar_status: 'connected',
          google_calendar_email: 'ceo@alpha-corp.com',
          google_calendar_account_id: 'google-sub-alpha-1001',
          google_calendar_calendar_id: 'primary',
          google_calendar_tokens: encryptGoogleTokens({
            access_token: 'ya29.tenant-a-active-token',
            refresh_token: '1//tenant-a-refresh-token',
            expiry_date: Date.now() + 3600_000,
          }),
        },
        [TENANT_B]: {
          account_id: TENANT_B,
          google_calendar_enabled: true,
          google_calendar_status: 'connected',
          google_calendar_email: 'founder@beta-studios.io',
          google_calendar_account_id: 'google-sub-beta-2002',
          google_calendar_calendar_id: 'custom-beta-cal@group.calendar.google.com',
          google_calendar_tokens: encryptGoogleTokens({
            access_token: 'ya29.tenant-b-active-token',
            refresh_token: '1//tenant-b-refresh-token',
            expiry_date: Date.now() + 3600_000,
          }),
        },
      };
    });

    it('demonstrates two different tenants connect separate Google accounts with isolated tokens', async () => {
      const mockDb = createMockDb();

      const tokenA = await getValidAccessTokenForAccount(mockDb, TENANT_A);
      const tokenB = await getValidAccessTokenForAccount(mockDb, TENANT_B);

      expect(tokenA).toBe('ya29.tenant-a-active-token');
      expect(tokenB).toBe('ya29.tenant-b-active-token');
      expect(tokenA).not.toBe(tokenB);

      const rawRowA = databaseSettings[TENANT_A].google_calendar_tokens;
      const rawRowB = databaseSettings[TENANT_B].google_calendar_tokens;
      expect(rawRowA).not.toContain('ya29.tenant-a-active-token');
      expect(rawRowB).not.toContain('ya29.tenant-b-active-token');

      const decryptedA = decryptGoogleTokens(rawRowA);
      const decryptedB = decryptGoogleTokens(rawRowB);
      expect(decryptedA?.access_token).toBe('ya29.tenant-a-active-token');
      expect(decryptedB?.access_token).toBe('ya29.tenant-b-active-token');
    });

    it('ensures Tenant A and Tenant B query separate calendar IDs and busy periods without cross-talk', async () => {
      const fetchCalls: Array<{ url: string; headers: Record<string, string>; body: { items?: Array<{ id: string }> } }> = [];

      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const headers = (init?.headers || {}) as Record<string, string>;
        const body = JSON.parse((init?.body as string) || '{}');
        fetchCalls.push({ url, headers, body });
        const calId = body.items?.[0]?.id;

        if (calId === 'primary') {
          return new Response(
            JSON.stringify({
              calendars: {
                primary: {
                  busy: [{ start: '2026-10-20T10:00:00Z', end: '2026-10-20T11:00:00Z' }],
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        } else if (calId === 'custom-beta-cal@group.calendar.google.com') {
          return new Response(
            JSON.stringify({
              calendars: {
                'custom-beta-cal@group.calendar.google.com': {
                  busy: [{ start: '2026-10-20T14:00:00Z', end: '2026-10-20T15:00:00Z' }],
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        return new Response('{}', { status: 200 });
      });

      const resA = await queryGoogleBusyPeriods(
        'ya29.tenant-a-active-token',
        '2026-10-20T00:00:00Z',
        '2026-10-20T23:59:59Z',
        databaseSettings[TENANT_A]?.google_calendar_calendar_id as string | undefined,
      );

      const resB = await queryGoogleBusyPeriods(
        'ya29.tenant-b-active-token',
        '2026-10-20T00:00:00Z',
        '2026-10-20T23:59:59Z',
        databaseSettings[TENANT_B]?.google_calendar_calendar_id as string | undefined,
      );

      expect(resA.success).toBe(true);
      expect(resA.busy).toEqual([{ start: '2026-10-20T10:00:00Z', end: '2026-10-20T11:00:00Z' }]);

      expect(resB.success).toBe(true);
      expect(resB.busy).toEqual([{ start: '2026-10-20T14:00:00Z', end: '2026-10-20T15:00:00Z' }]);

      expect(fetchCalls[0]?.headers.Authorization).toBe('Bearer ya29.tenant-a-active-token');
      expect(fetchCalls[0]?.body.items?.[0]?.id).toBe('primary');

      expect(fetchCalls[1]?.headers.Authorization).toBe('Bearer ya29.tenant-b-active-token');
      expect(fetchCalls[1]?.body.items?.[0]?.id).toBe('custom-beta-cal@group.calendar.google.com');
    });

    it('disconnecting Tenant A revokes Tenant A and leaves Tenant B completely intact and connected', async () => {
      let revokedToken: string | null = null;

      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes('oauth2.googleapis.com/revoke')) {
          const body = init?.body?.toString() || '';
          revokedToken = new URLSearchParams(body).get('token');
          return new Response('', { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      const mockDb = createMockDb();

      const disconnectResult = await disconnectGoogleCalendarForAccount(mockDb, TENANT_A);
      expect(disconnectResult.success).toBe(true);

      expect(revokedToken).toBe('1//tenant-a-refresh-token');

      expect(databaseSettings[TENANT_A].google_calendar_enabled).toBe(false);
      expect(databaseSettings[TENANT_A].google_calendar_status).toBe('disconnected');
      expect(databaseSettings[TENANT_A].google_calendar_email).toBeNull();
      expect(databaseSettings[TENANT_A].google_calendar_tokens).toBeNull();

      expect(databaseSettings[TENANT_B].google_calendar_enabled).toBe(true);
      expect(databaseSettings[TENANT_B].google_calendar_status).toBe('connected');
      expect(databaseSettings[TENANT_B].google_calendar_email).toBe('founder@beta-studios.io');
      expect(databaseSettings[TENANT_B].google_calendar_tokens).not.toBeNull();

      const tokenAAfter = await getValidAccessTokenForAccount(mockDb, TENANT_A);
      const tokenBAfter = await getValidAccessTokenForAccount(mockDb, TENANT_B);

      expect(tokenAAfter).toBeNull();
      expect(tokenBAfter).toBe('ya29.tenant-b-active-token');
    });

    it('auto-refreshes an expired token for Tenant A and persists back to Tenant A row without touching Tenant B', async () => {
      databaseSettings[TENANT_A].google_calendar_tokens = encryptGoogleTokens({
        access_token: 'ya29.expired-token-a',
        refresh_token: '1//tenant-a-refresh-token',
        expiry_date: Date.now() - 5000,
      });

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'ya29.refreshed-new-token-a',
              expires_in: 3600,
              token_type: 'Bearer',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('{}', { status: 200 });
      });

      const mockDb = createMockDb();

      const tokenA = await getValidAccessTokenForAccount(mockDb, TENANT_A);
      expect(tokenA).toBe('ya29.refreshed-new-token-a');

      const updatedRowA = databaseSettings[TENANT_A];
      const decryptedA = decryptGoogleTokens(updatedRowA.google_calendar_tokens);
      expect(decryptedA?.access_token).toBe('ya29.refreshed-new-token-a');
      expect(decryptedA?.refresh_token).toBe('1//tenant-a-refresh-token');
      expect(decryptedA?.expiry_date).toBeGreaterThan(Date.now() + 3000_000);
      expect(updatedRowA.google_calendar_status).toBe('connected');

      const decryptedB = decryptGoogleTokens(databaseSettings[TENANT_B].google_calendar_tokens);
      expect(decryptedB?.access_token).toBe('ya29.tenant-b-active-token');
    });

    it('handles revoked permissions on Google (invalid_grant) by marking tenant as expired', async () => {
      databaseSettings[TENANT_A].google_calendar_tokens = encryptGoogleTokens({
        access_token: 'ya29.expired-token-a',
        refresh_token: '1//tenant-a-revoked-by-user-on-google',
        expiry_date: Date.now() - 5000,
      });

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({
              error: 'invalid_grant',
              error_description: 'Token has been expired or revoked.',
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('{}', { status: 200 });
      });

      const mockDb = createMockDb();

      const tokenA = await getValidAccessTokenForAccount(mockDb, TENANT_A);
      expect(tokenA).toBeNull();

      expect(databaseSettings[TENANT_A].google_calendar_status).toBe('expired');
      expect(databaseSettings[TENANT_A].google_calendar_enabled).toBe(false);

      expect(databaseSettings[TENANT_B].google_calendar_status).toBe('connected');
      expect(databaseSettings[TENANT_B].google_calendar_enabled).toBe(true);
    });

    it('supports reconnection: reconnecting an expired or disconnected tenant restores connection without affecting other tenants', async () => {
      databaseSettings[TENANT_A].google_calendar_status = 'expired';
      databaseSettings[TENANT_A].google_calendar_enabled = false;

      const newTokens = {
        access_token: 'ya29.new-reconnected-token-a',
        refresh_token: '1//new-refresh-token-a',
        expiry_date: Date.now() + 3600_000,
      };

      const mockDb = createMockDb();
      await mockDb
        .from('scheduling_settings')
        .update({
          google_calendar_enabled: true,
          google_calendar_status: 'connected',
          google_calendar_email: 'ceo-new@alpha-corp.com',
          google_calendar_tokens: encryptGoogleTokens(newTokens),
        })
        .eq('account_id', TENANT_A);

      expect(databaseSettings[TENANT_A].google_calendar_status).toBe('connected');
      expect(databaseSettings[TENANT_A].google_calendar_enabled).toBe(true);
      expect(databaseSettings[TENANT_A].google_calendar_email).toBe('ceo-new@alpha-corp.com');

      const reconnectedToken = await getValidAccessTokenForAccount(mockDb, TENANT_A);
      expect(reconnectedToken).toBe('ya29.new-reconnected-token-a');

      const tokenB = await getValidAccessTokenForAccount(mockDb, TENANT_B);
      expect(tokenB).toBe('ya29.tenant-b-active-token');
    });
  });

  // ============================================================
  // 4. CALENDAR LISTING, EVENT LIFECYCLE & RESCHEDULE/DELETE
  // ============================================================
  describe('Calendar Listing & Event Lifecycle', () => {
    it('lists available Google calendars for the authenticated user', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [
              { id: 'primary', summary: 'Work Calendar', primary: true, timeZone: 'Asia/Kolkata' },
              { id: 'consulting@group.calendar.google.com', summary: 'Client Consultations', primary: false, timeZone: 'Asia/Kolkata' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const calendars = await listGoogleCalendars('test-access-token');
      expect(calendars).toHaveLength(2);
      expect(calendars[0].id).toBe('primary');
      expect(calendars[0].primary).toBe(true);
      expect(calendars[1].id).toBe('consulting@group.calendar.google.com');
      expect(calendars[1].primary).toBe(false);
    });

    it('gracefully handles token revocation API call without throwing', async () => {
      global.fetch = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
      const ok = await revokeGoogleToken('test-token');
      expect(ok).toBe(true);

      global.fetch = vi.fn().mockResolvedValue(new Response('{"error":"invalid_token"}', { status: 400 }));
      const ok400 = await revokeGoogleToken('already-revoked-token');
      expect(ok400).toBe(true);
    });

    it('creates, updates, and deletes Google Calendar events cleanly including 404/410 on delete', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 'g-event-999',
            htmlLink: 'https://calendar.google.com/event?eid=999',
            conferenceData: {
              entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const created = await createGoogleCalendarEvent(
        'ya29.valid-token',
        {
          title: 'Consultation Call',
          startTime: '2026-11-05T10:00:00Z',
          endTime: '2026-11-05T10:30:00Z',
          timezone: 'Asia/Kolkata',
          attendeeEmail: 'client@example.com',
          attendeeName: 'Client Name',
        },
        'custom-cal-id@group.calendar.google.com',
      );

      expect(created?.eventId).toBe('g-event-999');
      expect(created?.meetLink).toBe('https://meet.google.com/abc-defg-hij');

      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 'g-event-999',
            htmlLink: 'https://calendar.google.com/event?eid=999',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const updated = await updateGoogleCalendarEvent(
        'ya29.valid-token',
        'g-event-999',
        {
          startTime: '2026-11-05T11:00:00Z',
          endTime: '2026-11-05T11:30:00Z',
          timezone: 'Asia/Kolkata',
          title: 'Consultation Call (Updated)',
        },
        'custom-cal-id@group.calendar.google.com',
      );
      expect(updated?.eventId).toBe('g-event-999');

      global.fetch = vi.fn().mockResolvedValue(new Response('', { status: 410 }));
      const deleted410 = await deleteGoogleCalendarEvent(
        'ya29.valid-token',
        'g-event-999',
        'custom-cal-id@group.calendar.google.com',
      );
      expect(deleted410).toBe(true);
    });

    it('handles Google Calendar API failure without crashing and returns null', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response('Internal Calendar Error', { status: 500 }),
      );

      const result = await createGoogleCalendarEvent(
        'ya29.valid-token',
        {
          title: 'Consultation Call',
          startTime: '2026-11-05T10:00:00Z',
          endTime: '2026-11-05T10:30:00Z',
          timezone: 'Asia/Kolkata',
        },
        'primary',
      );

      expect(result).toBeNull();
    });
  });
});

