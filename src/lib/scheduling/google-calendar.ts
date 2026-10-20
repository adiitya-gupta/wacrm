/**
 * Google Calendar API integration for WACRM / OPSIYS.
 * Provides availability checking (freeBusy) and event creation with Google Meet links.
 * Uses direct fetch to Google Calendar REST APIs with zero heavy dependencies.
 */

export interface GoogleCalendarTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
  scope?: string;
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
): Promise<{ accessToken: string; expiryDate: number } | null> {
  const cId = clientId || process.env.GOOGLE_CLIENT_ID;
  const cSecret = clientSecret || process.env.GOOGLE_CLIENT_SECRET;

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
      console.error('[google-calendar] token refresh failed:', errText);
      return null;
    }

    const data = await res.json();
    return {
      accessToken: data.access_token,
      expiryDate: Date.now() + (data.expires_in || 3600) * 1000,
    };
  } catch (err) {
    console.error('[google-calendar] token refresh exception:', err);
    return null;
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
): Promise<{ tokens: GoogleCalendarTokens; email?: string } | null> {
  const cId = clientId || process.env.GOOGLE_CLIENT_ID;
  const cSecret = clientSecret || process.env.GOOGLE_CLIENT_SECRET;

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
      console.error('[google-calendar] code exchange failed:', errText);
      return null;
    }

    const data = await res.json();
    const tokens: GoogleCalendarTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expiry_date: Date.now() + (data.expires_in || 3600) * 1000,
      token_type: data.token_type,
      scope: data.scope,
    };

    let email: string | undefined;
    try {
      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (userRes.ok) {
        const userData = await userRes.json();
        email = userData.email;
      }
    } catch {
      // Non-fatal if userinfo fails
    }

    return { tokens, email };
  } catch (err) {
    console.error('[google-calendar] code exchange exception:', err);
    return null;
  }
}

/**
 * Ensure we have a valid Google access token, refreshing if expired.
 */
export async function getValidAccessToken(
  tokens: GoogleCalendarTokens,
): Promise<string | null> {
  if (!tokens.access_token) return null;

  // Check if expired or expiring within 2 minutes
  const isExpired = tokens.expiry_date && tokens.expiry_date < Date.now() + 120_000;
  if (!isExpired) return tokens.access_token;

  if (tokens.refresh_token) {
    const refreshed = await refreshGoogleAccessToken(tokens.refresh_token);
    if (refreshed) {
      tokens.access_token = refreshed.accessToken;
      tokens.expiry_date = refreshed.expiryDate;
      return refreshed.accessToken;
    }
  }

  return tokens.access_token;
}

/**
 * Query busy periods from Google Calendar for a date range.
 */
export async function queryGoogleBusyPeriods(
  accessToken: string,
  timeMin: string,
  timeMax: string,
  calendarId: string = 'primary',
): Promise<Array<{ start: string; end: string }>> {
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
      console.warn('[google-calendar] freeBusy query returned non-200:', res.status);
      return [];
    }

    const data = await res.json();
    const busy = data.calendars?.[calendarId]?.busy || [];
    return busy.map((b: { start: string; end: string }) => ({
      start: b.start,
      end: b.end,
    }));
  } catch (err) {
    console.warn('[google-calendar] freeBusy query failed (falling back to native):', err);
    return [];
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
      console.error('[google-calendar] event creation failed:', errBody);
      return null;
    }

    const created = await res.json();

    // Extract meet link
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
 * Delete / cancel an event on Google Calendar.
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
    return res.status === 204 || res.ok;
  } catch (err) {
    console.error('[google-calendar] event deletion exception:', err);
    return false;
  }
}
