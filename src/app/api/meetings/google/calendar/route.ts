import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/ai/admin-client';

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = await request.json();
    const rawCalendarId = body?.calendarId;
    const calendarId = typeof rawCalendarId === 'string' ? rawCalendarId.trim() : '';

    if (!calendarId) {
      return NextResponse.json(
        { error: 'calendarId is required and must be a non-empty string' },
        { status: 400 },
      );
    }

    const admin = supabaseAdmin();
    const { data: existing, error: fetchErr } = await admin
      .from('scheduling_settings')
      .select('id, google_calendar_enabled, google_calendar_status')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    if (!existing || !existing.google_calendar_enabled) {
      return NextResponse.json(
        { error: 'Google Calendar must be connected before selecting a calendar.' },
        { status: 400 },
      );
    }

    const { error: updateErr } = await admin
      .from('scheduling_settings')
      .update({
        google_calendar_calendar_id: calendarId,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', ctx.accountId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, calendarId });
  } catch (err) {
    return toErrorResponse(err);
  }
}

