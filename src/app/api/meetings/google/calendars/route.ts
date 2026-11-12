import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import {
  getValidAccessTokenForAccount,
  listGoogleCalendars,
} from '@/lib/scheduling/google-calendar';

export async function GET() {
  try {
    const ctx = await requireRole('viewer');
    const admin = supabaseAdmin();

    const accessToken = await getValidAccessTokenForAccount(admin, ctx.accountId);
    if (!accessToken) {
      return NextResponse.json({ calendars: [], connected: false });
    }

    const calendars = await listGoogleCalendars(accessToken);
    return NextResponse.json({ calendars, connected: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

