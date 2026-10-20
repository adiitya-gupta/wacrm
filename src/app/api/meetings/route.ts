import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { bookMeeting } from '@/lib/scheduling/booking';

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('viewer');
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status');
    const contactId = searchParams.get('contactId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const search = searchParams.get('search');

    let query = ctx.supabase
      .from('meetings')
      .select(`
        *,
        contact:contacts(id, name, phone, email, avatar_url)
      `)
      .eq('account_id', ctx.accountId)
      .order('start_time', { ascending: true });

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    if (contactId) {
      query = query.eq('contact_id', contactId);
    }

    if (startDate) {
      query = query.gte('start_time', startDate);
    }

    if (endDate) {
      query = query.lte('start_time', endDate);
    }

    if (search && search.trim()) {
      query = query.or(`title.ilike.%${search.trim()}%,service_requested.ilike.%${search.trim()}%`);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ meetings: data || [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = await request.json();

    const {
      contactId,
      title,
      description,
      serviceRequested,
      startTime,
      endTime,
      timezone,
      conversationId,
    } = body;

    if (!contactId || !title || !startTime) {
      return NextResponse.json(
        { error: 'contactId, title, and startTime are required' },
        { status: 400 },
      );
    }

    const result = await bookMeeting(ctx.supabase, {
      accountId: ctx.accountId,
      contactId,
      conversationId,
      title,
      description,
      serviceRequested,
      startTime,
      endTime,
      timezone,
      bookingSource: 'manual',
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to book meeting', message: result.message },
        { status: 409 },
      );
    }

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
