/**
 * Google Calendar API integration for WACRM / OPSIYS.
 * Multi-tenant SaaS integration:
 * - Independent tenant connection and token storage
 * - Authenticated AES-256-GCM encryption of tokens and state payloads at rest
 * - Scoped token auto-refresh and database persistence
 * - FreeBusy availability checking and Google Meet event lifecycle (create / update / delete)
 * Uses direct fetch to Google Calendar REST APIs with zero heavy dependencies.
 */

import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';

export interface GoogleCalendarTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
  scope?: string;
}

export interface GoogleOAuthStatePayload {
  accountId: string;
  userId: string;
  nonce: string;
  timestamp: number;
}

/**
 * Encrypt Google OAuth tokens at rest using AES-256-GCM.
 */
export function encryptGoogleTokens(tokens: GoogleCalendarTokens): string {
  return encrypt(JSON.stringify(tokens));
}

/**
 * Decrypt Google OAuth tokens from database storage.
 * Handles both encrypted string formats and legacy JSON object shapes safely.
 */
export function decryptGoogleTokens(raw: unknown): GoogleCalendarTokens | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const decrypted = decrypt(raw);
      return JSON.parse(decrypted) as GoogleCalendarTokens;
    } catch (err) {
      console.error(
        '[google-calendar] failed to decrypt tokens:',
        err instanceof Error ? err.message : 'decrypt error',
      );
      return null;
    }
  }
  if (typeof raw === 'object' && raw !== null && 'access_token' in raw) {
    return raw as GoogleCalendarTokens;
  }
  return null;
}

/**
 * Create a cryptographically tamper-proof OAuth state string.
 * Encrypted using AES-256-GCM via the platform ENCRYPTION_KEY and base64url encoded.
 * Contains the tenant's accountId, initiating userId, a unique nonce, and a creation timestamp.
 */
export function createGoogleOAuthState(payload: {
  accountId: string;
  userId: string;
  nonce?: string;
  timestamp?: number;
}): { state: string; nonce: string } {
  const nonce = payload.nonce || crypto.randomBytes(24).toString('hex');
  const fullPayload: GoogleOAuthStatePayload = {
    accountId: payload.accountId,
    userId: payload.userId,
    nonce,
    timestamp: payload.timestamp ?? Date.now(),
  };

  const encrypted = encrypt(JSON.stringify(fullPayload));
  const state = Buffer.from(encrypted, 'utf8').toString('base64url');
  return { state, nonce };
}

/**
 * Validate and decrypt an incoming OAuth state string.
 * Verifies authenticity (AES-256-GCM auth tag) and enforces the expiration window.
 */
export function validateGoogleOAuthState(
  stateRaw: string,
  maxAgeMs: number = 15 * 60 * 1000,
): { valid: true; payload: GoogleOAuthStatePayload } | { valid: false; error: string } {
  if (!stateRaw || typeof stateRaw !== 'string') {
    return { valid: false, error: 'MISSING_STATE' };
  }

  try {
    const encrypted = Buffer.from(stateRaw, 'base64url').toString('utf8');
    const decrypted = decrypt(encrypted);
    const payload = JSON.parse(decrypted) as GoogleOAuthStatePayload;

    if (!payload.accountId || !payload.userId || !payload.nonce || !payload.timestamp) {
      return { valid: false, error: 'MALFORMED_STATE_PAYLOAD' };
    }

    if (Date.now() - payload.timestamp > maxAgeMs) {
      return { valid: false, error: 'STATE_EXPIRED' };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false, error: 'INVALID_STATE_CIPHERTEXT' };
  }
}

export interface GoogleCalendarEventInput {
  title: string;
  description?: string;
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  timezone: string;
  attendeeEmail?: string;
  attendeeName?: string;
}

export interface GoogleCalendarEventResult {
  eventId: string;
  htmlLink?: string;
  meetLink?: string;
}

/**
 * Refresh an expired Google OAuth access token using the stored refresh_token.
 */
export async function refreshGoogleAccessToken(
  refreshToken: string,
  clientId?: string,
  clientSecret?: string,
): Promise<{ accessToken: string; expiryDate: number; refreshToken?: string } | null> {
  const cId = (clientId || process.env.GOOGLE_CLIENT_ID || '').trim();
  const cSecret = (clientSecret || process.env.GOOGLE_CLIENT_SECRET || '').trim();

  if (!cId || !cSecret) {
    console.warn('[google-calendar] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not configured');
    return null;
  }

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cId,
        client_secret: cSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[google-calendar] token refresh failed (HTTP ${res.status}):`, errText);
      return null;
    }

    const data = await res.json();
    if (!data?.access_token) {
      console.error('[google-calendar] token refresh returned empty access_token');
      return null;
    }

    return {
      accessToken: data.access_token,
      expiryDate: Date.now() + (data.expires_in || 3600) * 1000,
      refreshToken: typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : undefined,
    };
  } catch (err) {
    console.error('[google-calendar] token refresh exception:', err);
    return null;
  }
}

/**
 * Revoke a Google OAuth token (access token or refresh token) upon disconnect.
 */
export async function revokeGoogleToken(token: string): Promise<boolean> {
  if (!token) return true;
  try {
    const res = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
    return res.ok || res.status === 400; // 400 means already invalid/revoked
  } catch (err) {
    console.warn('[google-calendar] token revocation exception (proceeding with disconnect):', err);
    return false;
  }
}

/**
 * Exchange an OAuth authorization code for Google Calendar tokens and user info.
 */
export async function exchangeGoogleCodeForTokens(
  code: string,
  redirectUri: string,
  clientId?: string,
  clientSecret?: string,
): Promise<{ tokens: GoogleCalendarTokens; email?: string; googleAccountId?: string } | null> {
  const cId = (clientId || process.env.GOOGLE_CLIENT_ID || '').trim();
  const cSecret = (clientSecret || process.env.GOOGLE_CLIENT_SECRET || '').trim();

  if (!cId || !cSecret) {
    console.warn('[google-calendar] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not configured');
    return null;
  }

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cId,
        client_secret: cSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[google-calendar] code exchange failed (HTTP ${res.status}):`, errText);
      return null;
    }

    const data = await res.json();
    if (!data?.access_token) {
      console.error('[google-calendar] code exchange returned empty access_token');
      return null;
    }

    const tokens: GoogleCalendarTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expiry_date: Date.now() + (data.expires_in || 3600) * 1000,
      token_type: data.token_type,
      scope: data.scope,
    };

    let email: string | undefined;
    let googleAccountId: string | undefined;

    try {
      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (userRes.ok) {
        const userData = await userRes.json();
        email = userData.email;
        googleAccountId = userData.id || userData.sub;
      }
    } catch {
      // Non-fatal if userinfo fails
    }

    return { tokens, email, googleAccountId };
  } catch (err) {
    console.error('[google-calendar] code exchange exception:', err);
    return null;
  }
}

/**
 * In-memory token validator (standalone utility).
 * Never returns an expired token if refresh fails.
 */
export async function getValidAccessToken(
  tokens: GoogleCalendarTokens,
): Promise<string | null> {
  if (!tokens.access_token) return null;

  // Check if expired or expiring within 2 minutes
  const isExpired = Boolean(tokens.expiry_date && tokens.expiry_date < Date.now() + 120_000);
  if (!isExpired) return tokens.access_token;

  if (!tokens.refresh_token) {
    return null;
  }

  const refreshed = await refreshGoogleAccessToken(tokens.refresh_token);
  if (!refreshed) {
    return null;
  }

  tokens.access_token = refreshed.accessToken;
  tokens.expiry_date = refreshed.expiryDate;
  if (refreshed.refreshToken) {
    tokens.refresh_token = refreshed.refreshToken;
  }
  return refreshed.accessToken;
}

/**
 * Multi-tenant token retriever: fetches, decrypts, and automatically refreshes and persists
 * Google Calendar tokens for a specific tenant workspace.
 *
 * If decryption fails, marks google_calendar_status as 'error'.
 * If permissions were revoked or token cannot be refreshed, marks google_calendar_status as 'expired'.
 */
export async function getValidAccessTokenForAccount(
  db: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  const { data: row, error } = await db
    .from('scheduling_settings')
    .select('google_calendar_tokens, google_calendar_enabled, google_calendar_status')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error || !row || !row.google_calendar_enabled || !row.google_calendar_tokens) {
    return null;
  }

  const tokens = decryptGoogleTokens(row.google_calendar_tokens);
  if (!tokens || !tokens.access_token) {
    console.warn(`[google-calendar] Account ${accountId} has invalid or un-decryptable tokens`);
    await db
      .from('scheduling_settings')
      .update({
        google_calendar_status: 'error',
        google_calendar_enabled: false,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId);
    return null;
  }

  const isExpired = Boolean(tokens.expiry_date && tokens.expiry_date < Date.now() + 120_000);
  if (!isExpired) {
    return tokens.access_token;
  }

  // Token is expired; attempt refresh using refresh_token
  if (!tokens.refresh_token) {
    console.warn(`[google-calendar] Account ${accountId} token is expired but has no refresh_token`);
    await db
      .from('scheduling_settings')
      .update({
        google_calendar_status: 'expired',
        google_calendar_enabled: false,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId);
    return null;
  }

  const refreshed = await refreshGoogleAccessToken(tokens.refresh_token);
  if (!refreshed) {
    console.warn(`[google-calendar] Account ${accountId} token refresh failed (permissions revoked or invalid_grant)`);
    await db
      .from('scheduling_settings')
      .update({
        google_calendar_status: 'expired',
        google_calendar_enabled: false,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId);
    return null;
  }

  // Persist refreshed tokens back to this tenant's row, preserving existing refresh_token unless rotated
  tokens.access_token = refreshed.accessToken;
  tokens.expiry_date = refreshed.expiryDate;
  if (refreshed.refreshToken) {
    tokens.refresh_token = refreshed.refreshToken;
  }
  const encryptedTokens = encryptGoogleTokens(tokens);

  const { error: persistErr } = await db
    .from('scheduling_settings')
    .update({
      google_calendar_tokens: encryptedTokens,
      google_calendar_status: 'connected',
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', accountId);

  if (persistErr) {
    console.warn(`[google-calendar] Failed to persist refreshed tokens for account ${accountId}:`, persistErr.message);
  }

  return refreshed.accessToken;
}

/**
 * List the user's Google Calendars to allow selecting a specific calendar ID.
 */
export async function listGoogleCalendars(
  accessToken: string,
): Promise<Array<{ id: string; summary: string; primary?: boolean; timeZone?: string }>> {
  try {
    const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      console.warn(`[google-calendar] calendarList returned status ${res.status}`);
      return [];
    }

    const data = await res.json();
    return (data.items || []).map((c: { id: string; summary?: string; primary?: boolean; timeZone?: string }) => ({
      id: c.id,
      summary: c.summary || '',
      primary: Boolean(c.primary),
      timeZone: c.timeZone,
    }));
  } catch (err) {
    console.error('[google-calendar] listGoogleCalendars exception:', err);
    return [];
  }
}

/**
 * Disconnect Google Calendar for a tenant:
 * 1. Revokes the token with Google
 * 2. Clears stored tokens and sets status to 'disconnected' strictly for that account
 */
export async function disconnectGoogleCalendarForAccount(
  db: SupabaseClient,
  accountId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: row } = await db
      .from('scheduling_settings')
      .select('google_calendar_tokens')
      .eq('account_id', accountId)
      .maybeSingle();

    if (row?.google_calendar_tokens) {
      const tokens = decryptGoogleTokens(row.google_calendar_tokens);
      if (tokens) {
        const tokenToRevoke = tokens.refresh_token || tokens.access_token;
        if (tokenToRevoke) {
          await revokeGoogleToken(tokenToRevoke);
        }
      }
    }

    const { error: updateErr } = await db
      .from('scheduling_settings')
      .update({
        google_calendar_enabled: false,
        google_calendar_status: 'disconnected',
        google_calendar_email: null,
        google_calendar_account_id: null,
        google_calendar_tokens: null,
        google_calendar_calendar_id: 'primary',
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId);

    if (updateErr) {
      console.error(`[google-calendar] Failed to update scheduling_settings on disconnect for account ${accountId}:`, updateErr);
      return { success: false, error: updateErr.message };
    }

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[google-calendar] Disconnect exception for account ${accountId}:`, msg);
    return { success: false, error: msg };
  }
}

/**
 * Query busy periods from Google Calendar for a date range.
 * Returns an explicit status object with error details so calendar failures
 * are not silently swallowed into fabricated availability.
 */
export async function queryGoogleBusyPeriods(
  accessToken: string,
  timeMin: string,
  timeMax: string,
  calendarId: string = 'primary',
): Promise<{ success: boolean; busy: Array<{ start: string; end: string }>; error?: string }> {
  try {
    const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        timeMin,
        timeMax,
        items: [{ id: calendarId }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      let msg = `Google Calendar freeBusy query returned HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403) {
        msg = `Google Calendar unauthorized or expired permissions (HTTP ${res.status})`;
      } else if (res.status === 404) {
        msg = `Google Calendar '${calendarId}' not found`;
      }
      console.warn(`[google-calendar] ${msg}:`, errText);
      return { success: false, busy: [], error: msg };
    }

    const data = await res.json();
    const calData = data.calendars?.[calendarId];
    if (calData?.errors && calData.errors.length > 0) {
      const reason = calData.errors.map((e: { reason: string }) => e.reason).join(', ');
      console.warn(`[google-calendar] calendar errors for '${calendarId}':`, reason);
      return { success: false, busy: [], error: `Calendar error: ${reason}` };
    }

    const busy = (calData?.busy || []).map((b: { start: string; end: string }) => ({
      start: b.start,
      end: b.end,
    }));
    return { success: true, busy };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network exception';
    console.warn('[google-calendar] freeBusy query exception:', msg);
    return { success: false, busy: [], error: msg };
  }
}

/**
 * Create an event on Google Calendar with a Google Meet conference.
 */
export async function createGoogleCalendarEvent(
  accessToken: string,
  input: GoogleCalendarEventInput,
  calendarId: string = 'primary',
): Promise<GoogleCalendarEventResult | null> {
  try {
    const requestId = `meet_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const eventPayload: Record<string, unknown> = {
      summary: input.title,
      description: input.description || 'OPSIYS Discovery Meeting booked via WhatsApp.',
      start: {
        dateTime: input.startTime,
        timeZone: input.timezone,
      },
      end: {
        dateTime: input.endTime,
        timeZone: input.timezone,
      },
      conferenceData: {
        createRequest: {
          requestId,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    };

    if (input.attendeeEmail) {
      eventPayload.attendees = [
        {
          email: input.attendeeEmail,
          displayName: input.attendeeName || undefined,
        },
      ];
    }

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventPayload),
      },
    );

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`[google-calendar] event creation failed (HTTP ${res.status}):`, errBody);
      return null;
    }

    const created = await res.json();

    const meetLink =
      created.conferenceData?.entryPoints?.find(
        (ep: { entryPointType: string; uri: string }) => ep.entryPointType === 'video',
      )?.uri || created.hangoutLink || undefined;

    return {
      eventId: created.id,
      htmlLink: created.htmlLink,
      meetLink,
    };
  } catch (err) {
    console.error('[google-calendar] event create exception:', err);
    return null;
  }
}

/**
 * Update (reschedule) an existing Google Calendar event.
 */
export async function updateGoogleCalendarEvent(
  accessToken: string,
  eventId: string,
  input: {
    startTime: string;
    endTime: string;
    timezone: string;
    title?: string;
    description?: string;
  },
  calendarId: string = 'primary',
): Promise<GoogleCalendarEventResult | null> {
  try {
    const patchPayload: Record<string, unknown> = {
      start: {
        dateTime: input.startTime,
        timeZone: input.timezone,
      },
      end: {
        dateTime: input.endTime,
        timeZone: input.timezone,
      },
    };
    if (input.title) patchPayload.summary = input.title;
    if (input.description !== undefined) patchPayload.description = input.description;

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?conferenceDataVersion=1`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(patchPayload),
      },
    );

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`[google-calendar] event update failed (HTTP ${res.status}):`, errBody);
      return null;
    }

    const updated = await res.json();
    const meetLink =
      updated.conferenceData?.entryPoints?.find(
        (ep: { entryPointType: string; uri: string }) => ep.entryPointType === 'video',
      )?.uri || updated.hangoutLink || undefined;

    return {
      eventId: updated.id || eventId,
      htmlLink: updated.htmlLink,
      meetLink,
    };
  } catch (err) {
    console.error('[google-calendar] event update exception:', err);
    return null;
  }
}

/**
 * Delete / cancel an event on Google Calendar.
 * Treats 404/410 (already deleted on Google) cleanly as removed.
 */
export async function deleteGoogleCalendarEvent(
  accessToken: string,
  eventId: string,
  calendarId: string = 'primary',
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    return res.status === 204 || res.status === 404 || res.status === 410 || res.ok;
  } catch (err) {
    console.error('[google-calendar] event deletion exception:', err);
    return false;
  }
}
