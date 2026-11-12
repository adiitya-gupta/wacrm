import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { createGoogleOAuthState } from '@/lib/scheduling/google-calendar';

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin');

    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: 'GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not configured in platform environment variables' },
        { status: 400 },
      );
    }

    const { origin } = new URL(request.url);
    const appUrl = (
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
      origin
    ).replace(/\/+$/, '');
    const redirectUri = `${appUrl}/api/meetings/google/callback`;

    // Generate tamper-proof AES-256-GCM encrypted state bound to tenant accountId & initiating userId
    const { state, nonce } = createGoogleOAuthState({
      accountId: ctx.accountId,
      userId: ctx.userId,
    });

    const scopes = [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' ');

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes,
      access_type: 'offline',
      prompt: 'consent',
      state,
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    const res = NextResponse.json({ url: authUrl });

    // Set anti-CSRF / account-linking nonce cookie (HttpOnly, SameSite=Lax)
    res.cookies.set('google_oauth_nonce', nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 15 * 60, // 15 minutes
    });

    return res;
  } catch (err) {
    return toErrorResponse(err);
  }
}
