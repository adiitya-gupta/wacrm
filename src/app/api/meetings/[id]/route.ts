import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { cancelMeeting, rescheduleMeeting } from '@/lib/scheduling/booking';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const ctx = await requireRole('viewer');
    const { id } = await context.params;

    const { data: meeting, error } = await ctx.supabase
      .from('meetings')
      .select(`
        *,
        contact:contacts(*),
        assigned_user:profiles!meetings_assigned_user_id_fkey(*)
      `)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!meeting) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    return NextResponse.json({ meeting });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await context.params;
    const body = await request.json();

    const { startTime, endTime, durationMinutes, timezone, rescheduleReason, status } = body;

    // Status-only update (e.g. mark completed or no_show)
    if (status && !startTime) {
      const { data: updated, error } = await ctx.supabase
        .from('meetings')
        .update({
          status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('account_id', ctx.accountId)
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, meeting: updated });
    }

    // Reschedule flow
    if (startTime) {
      let resolvedEndTime = endTime;
      if (!resolvedEndTime && typeof durationMinutes === 'number' && durationMinutes > 0) {
        const startMs = new Date(startTime).getTime();
        if (!Number.isNaN(startMs)) {
          resolvedEndTime = new Date(startMs + durationMinutes * 60 * 1000).toISOString();
        }
      }

      const result = await rescheduleMeeting(ctx.supabase, {
        meetingId: id,
        accountId: ctx.accountId,
        newStartTime: startTime,
        newEndTime: resolvedEndTime,
        timezone,
        rescheduleReason,
      });

      if (!result.success) {
        const errStatus = result.error === 'Meeting not found' ? 404 : 409;
        return NextResponse.json(
          { error: result.error || 'Reschedule failed' },
          { status: errStatus },
        );
      }

      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'No update parameters provided' }, { status: 400 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const body = await request.json().catch(() => null);
    const bodyReason =
      body && typeof body.reason === 'string' && body.reason.trim()
        ? body.reason.trim()
        : undefined;
    const queryReason = searchParams.get('reason')?.trim() || undefined;
    const reason = queryReason || bodyReason || 'Cancelled by agent';

    const result = await cancelMeeting(ctx.supabase, {
      meetingId: id,
      accountId: ctx.accountId,
      reason,
    });

    if (!result.success) {
      const errStatus = result.error === 'Meeting not found' ? 404 : 400;
      return NextResponse.json(
        { error: result.error || 'Cancellation failed' },
        { status: errStatus },
      );
    }

    return NextResponse.json({ success: true, message: 'Meeting cancelled successfully' });
  } catch (err) {
    return toErrorResponse(err);
  }
}
