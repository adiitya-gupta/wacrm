import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  supabaseAdmin: vi.fn(),
  exchangeGoogleCodeForTokens: vi.fn(),
  disconnectGoogleCalendarForAccount: vi.fn(),
  getValidAccessTokenForAccount: vi.fn(),
  listGoogleCalendars: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((err) =>
    NextResponse.json(
      { error: err instanceof Error ? err.message : 'auth error' },
      { status: (err as { status?: number })?.status || 500 },
    ),
  ),
}));

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}));

vi.mock('@/lib/scheduling/google-calendar', async () => {
  const actual = await vi.importActual<typeof import('@/lib/scheduling/google-calendar')>(
    '@/lib/scheduling/google-calendar',
  );
  return {
    ...actual,
    exchangeGoogleCodeForTokens: mocks.exchangeGoogleCodeForTokens,
    disconnectGoogleCalendarForAccount: mocks.disconnectGoogleCalendarForAccount,
    getValidAccessTokenForAccount: mocks.getValidAccessTokenForAccount,
    listGoogleCalendars: mocks.listGoogleCalendars,
  };
});

import { GET as authGet } from './auth/route';
import { GET as callbackGet } from './callback/route';
import { DELETE as disconnectDelete } from './route';
import { GET as calendarsGet } from './calendars/route';
import { PUT as calendarPut } from './calendar/route';
import {
  createGoogleOAuthState,
  validateGoogleOAuthState,
  encryptGoogleTokens,
  decryptGoogleTokens,
} from '@/lib/scheduling/google-calendar';

describe('/api/meetings/google API Routes', () => {
  const TENANT_ID = 'tenant-saas-alpha-uuid';
  const USER_ID = 'user-admin-alpha-uuid';

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.wattomation.com';
    delete process.env.NEXT_PUBLIC_SITE_URL;

    mocks.requireRole.mockResolvedValue({
      accountId: TENANT_ID,
      userId: USER_ID,
      role: 'admin',
    });
  });

  describe('GET /api/meetings/google/auth', () => {
    it('generates a signed AES-256-GCM state and sets anti-CSRF nonce cookie', async () => {
      const req = new Request('https://app.wattomation.com/api/meetings/google/auth');
      const res = await authGet(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(data.url).toContain('client_id=test-client-id');
      expect(data.url).toContain('access_type=offline');
      expect(data.url).toContain('prompt=consent');
      expect(data.url).toContain(encodeURIComponent('https://app.wattomation.com/api/meetings/google/callback'));

      const cookieHeader = res.headers.get('set-cookie');
      expect(cookieHeader).toContain('google_oauth_nonce=');

      const parsedUrl = new URL(data.url);
      const stateParam = parsedUrl.searchParams.get('state');
      expect(stateParam).toBeTruthy();

      const stateVal = validateGoogleOAuthState(stateParam!);
      expect(stateVal.valid).toBe(true);
      if (stateVal.valid) {
        expect(stateVal.payload.accountId).toBe(TENANT_ID);
        expect(stateVal.payload.userId).toBe(USER_ID);
      }
    });

    it('falls back to NEXT_PUBLIC_SITE_URL when NEXT_PUBLIC_APP_URL is unset', async () => {
      delete process.env.NEXT_PUBLIC_APP_URL;
      process.env.NEXT_PUBLIC_SITE_URL = 'https://site.wattomation.com/';

      const req = new Request('http://localhost/api/meetings/google/auth');
      const res = await authGet(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.url).toContain(encodeURIComponent('https://site.wattomation.com/api/meetings/google/callback'));
    });

    it('rejects unauthenticated or unauthorized users', async () => {
      mocks.requireRole.mockRejectedValue(new Error('Forbidden'));
      const req = new Request('https://app.wattomation.com/api/meetings/google/auth');
      const res = await authGet(req);
      expect(res.status).toBe(500);
    });
  });

  describe('GET /api/meetings/google/callback', () => {
    it('redirects with error if code or state is missing', async () => {
      const req = new Request('https://app.wattomation.com/api/meetings/google/callback');
      const res = await callbackGet(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=missing_code_or_state');
    });

    it('rejects an invalid or tampered state', async () => {
      const req = new Request('https://app.wattomation.com/api/meetings/google/callback?code=valid-code&state=forged-state');
      const res = await callbackGet(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=invalid_state_ciphertext');
    });

    it('rejects with CSRF error if nonce cookie is missing or does not match state nonce', async () => {
      const { state } = createGoogleOAuthState({
        accountId: TENANT_ID,
        userId: USER_ID,
        nonce: 'correct-nonce-12345',
      });

      const req = new Request(
        `https://app.wattomation.com/api/meetings/google/callback?code=valid-code&state=${encodeURIComponent(state)}`,
        {
          headers: {
            cookie: 'google_oauth_nonce=wrong-attacker-nonce',
          },
        },
      );

      const res = await callbackGet(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=csrf_nonce_mismatch');
    });

    it('rejects callback if profile no longer holds admin/owner role for the state tenant', async () => {
      const { state, nonce } = createGoogleOAuthState({
        accountId: TENANT_ID,
        userId: USER_ID,
      });

      mocks.supabaseAdmin.mockReturnValue({
        from: (table: string) => {
          if (table === 'profiles') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { account_id: TENANT_ID, account_role: 'viewer' },
                    error: null,
                  }),
                }),
              }),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        },
      });

      const req = new Request(
        `https://app.wattomation.com/api/meetings/google/callback?code=valid-auth-code&state=${encodeURIComponent(state)}`,
        {
          headers: { cookie: `google_oauth_nonce=${nonce}` },
        },
      );

      const res = await callbackGet(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=unauthorized_tenant_role');
    });

    it('successfully connects Google Calendar and preserves previous refresh_token and custom calendar_id on reconnect', async () => {
      const { state, nonce } = createGoogleOAuthState({
        accountId: TENANT_ID,
        userId: USER_ID,
      });

      mocks.exchangeGoogleCodeForTokens.mockResolvedValue({
        tokens: {
          access_token: 'ya29.new-access-only',
          expiry_date: Date.now() + 3600_000,
        },
        email: 'workspace-admin@tenant-alpha.com',
        googleAccountId: 'google-sub-777',
      });

      const prevEncrypted = encryptGoogleTokens({
        access_token: 'ya29.old-access',
        refresh_token: '1//preserved-refresh-token',
      });

      let updatedRecord: Record<string, unknown> | null = null;
      mocks.supabaseAdmin.mockReturnValue({
        from: (table: string) => {
          if (table === 'profiles') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { account_id: TENANT_ID, account_role: 'admin' },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === 'scheduling_settings') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'settings-1',
                      google_calendar_tokens: prevEncrypted,
                      google_calendar_calendar_id: 'custom-team@group.calendar.google.com',
                    },
                    error: null,
                  }),
                }),
              }),
              update: (payload: Record<string, unknown>) => ({
                eq: (col: string, val: string) => {
                  updatedRecord = { ...payload, [col]: val };
                  return Promise.resolve({ error: null });
                },
              }),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        },
      });

      const req = new Request(
        `https://app.wattomation.com/api/meetings/google/callback?code=valid-auth-code&state=${encodeURIComponent(state)}`,
        {
          headers: {
            cookie: `google_oauth_nonce=${nonce}`,
          },
        },
      );

      const res = await callbackGet(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('/meetings?connected=google');

      expect(updatedRecord).toBeTruthy();
      const record = updatedRecord!;
      expect(record.account_id).toBe(TENANT_ID);
      expect(record.google_calendar_enabled).toBe(true);
      expect(record.google_calendar_status).toBe('connected');
      expect(record.google_calendar_email).toBe('workspace-admin@tenant-alpha.com');
      expect(record.google_calendar_account_id).toBe('google-sub-777');
      expect(record.google_calendar_calendar_id).toBe('custom-team@group.calendar.google.com');

      const stored = decryptGoogleTokens(record.google_calendar_tokens);
      expect(stored?.access_token).toBe('ya29.new-access-only');
      expect(stored?.refresh_token).toBe('1//preserved-refresh-token');
    });
  });

  describe('DELETE /api/meetings/google', () => {
    it('disconnects Google Calendar for the tenant workspace', async () => {
      mocks.disconnectGoogleCalendarForAccount.mockResolvedValue({ success: true });
      mocks.supabaseAdmin.mockReturnValue({});

      const res = await disconnectDelete();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(mocks.disconnectGoogleCalendarForAccount).toHaveBeenCalledWith(
        expect.anything(),
        TENANT_ID,
      );
    });
  });

  describe('GET /api/meetings/google/calendars', () => {
    it('returns calendar list for connected tenant', async () => {
      mocks.getValidAccessTokenForAccount.mockResolvedValue('valid-access-token');
      mocks.listGoogleCalendars.mockResolvedValue([
        { id: 'primary', summary: 'Primary Calendar', primary: true },
        { id: 'team@group.calendar.google.com', summary: 'Team Calendar', primary: false },
      ]);
      mocks.supabaseAdmin.mockReturnValue({});

      const res = await calendarsGet();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.connected).toBe(true);
      expect(data.calendars).toHaveLength(2);
    });
  });

  describe('PUT /api/meetings/google/calendar', () => {
    it('updates selected calendar ID for connected tenant', async () => {
      let updatedCol: { payload: Record<string, unknown>; col: string; val: string } | null = null;
      mocks.supabaseAdmin.mockReturnValue({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 'settings-1', google_calendar_enabled: true, google_calendar_status: 'connected' },
                error: null,
              }),
            }),
          }),
          update: (payload: Record<string, unknown>) => ({
            eq: (col: string, val: string) => {
              updatedCol = { payload, col, val };
              return Promise.resolve({ error: null });
            },
          }),
        }),
      });

      const req = new Request('https://app.wattomation.com/api/meetings/google/calendar', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calendarId: 'sales@group.calendar.google.com' }),
      });

      const res = await calendarPut(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.calendarId).toBe('sales@group.calendar.google.com');

      const col = updatedCol!;
      expect(col.val).toBe(TENANT_ID);
      expect(col.payload.google_calendar_calendar_id).toBe('sales@group.calendar.google.com');
    });

    it('rejects calendar selection when Google Calendar is disconnected or calendarId is empty', async () => {
      mocks.supabaseAdmin.mockReturnValue({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 'settings-1', google_calendar_enabled: false, google_calendar_status: 'disconnected' },
                error: null,
              }),
            }),
          }),
        }),
      });

      const emptyReq = new Request('https://app.wattomation.com/api/meetings/google/calendar', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calendarId: '   ' }),
      });
      const emptyRes = await calendarPut(emptyReq);
      expect(emptyRes.status).toBe(400);

      const disconnReq = new Request('https://app.wattomation.com/api/meetings/google/calendar', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calendarId: 'primary' }),
      });
      const disconnRes = await calendarPut(disconnReq);
      expect(disconnRes.status).toBe(400);
    });
  });
});

