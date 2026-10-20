import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { loadSchedulingSettings } from '@/lib/scheduling/availability';

export async function GET() {
  try {
    const ctx = await requireRole('viewer');
    const settings = await loadSchedulingSettings(ctx.supabase, ctx.accountId);
    return NextResponse.json({ settings });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = await request.json();

    const {
      meetingDurationMinutes,
      workingDays,
      workingHoursStart,
      workingHoursEnd,
      timezone,
      bufferBeforeMinutes,
      bufferAfterMinutes,
      minimumNoticeHours,
      maxAdvanceDays,
      defaultMeetingLink,
      googleCalendarEnabled,
    } = body;

    const payload: Record<string, unknown> = {
      account_id: ctx.accountId,
      updated_at: new Date().toISOString(),
    };

    if (meetingDurationMinutes !== undefined) payload.meeting_duration_minutes = meetingDurationMinutes;
    if (workingDays !== undefined) payload.working_days = workingDays;
    if (workingHoursStart !== undefined) payload.working_hours_start = workingHoursStart;
    if (workingHoursEnd !== undefined) payload.working_hours_end = workingHoursEnd;
    if (timezone !== undefined) payload.timezone = timezone;
    if (bufferBeforeMinutes !== undefined) payload.buffer_before_minutes = bufferBeforeMinutes;
    if (bufferAfterMinutes !== undefined) payload.buffer_after_minutes = bufferAfterMinutes;
    if (minimumNoticeHours !== undefined) payload.minimum_notice_hours = minimumNoticeHours;
    if (maxAdvanceDays !== undefined) payload.max_advance_days = maxAdvanceDays;
    if (defaultMeetingLink !== undefined) payload.default_meeting_link = defaultMeetingLink;
    if (googleCalendarEnabled !== undefined) payload.google_calendar_enabled = googleCalendarEnabled;

    const { data: updated, error } = await ctx.supabase
      .from('scheduling_settings')
      .upsert(payload, { onConflict: 'account_id' })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ settings: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
