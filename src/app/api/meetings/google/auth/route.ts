import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin');

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return NextResponse.json(
        { error: 'GOOGLE_CLIENT_ID is not configured in environment variables' },
        { status: 400 },
      );
    }

    const { origin } = new URL(request.url);
    const redirectUri = `${origin}/api/meetings/google/callback`;

    const state = Buffer.from(
      JSON.stringify({
        accountId: ctx.accountId,
        userId: ctx.userId,
        timestamp: Date.now(),
      }),
    ).toString('base64url');

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
    return NextResponse.json({ url: authUrl });
  } catch (err) {
    return toErrorResponse(err);
  }
}
