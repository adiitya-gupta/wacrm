import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookingResult, Meeting } from '@/types/meetings';
import { loadSchedulingSettings } from './availability';
import {
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  getValidAccessToken,
  type GoogleCalendarTokens,
} from './google-calendar';

export interface BookMeetingArgs {
  accountId: string;
  contactId: string;
  conversationId?: string | null;
  title: string;
  description?: string;
  serviceRequested?: string;
  startTime: Date | string;
  endTime?: Date | string; // defaults to startTime + meeting_duration_minutes
  timezone?: string;
  bookingSource?: 'whatsapp_ai' | 'manual' | 'web_link';
  leadSummary?: string;
  idempotencyKey?: string;
  attendeeEmail?: string;
  attendeeName?: string;
}

export interface RescheduleMeetingArgs {
  meetingId: string;
  accountId: string;
  newStartTime: Date | string;
  newEndTime?: Date | string;
  timezone?: string;
  rescheduleReason?: string;
}

export interface CancelMeetingArgs {
  meetingId: string;
  accountId: string;
  reason?: string;
}

/**
 * Atomically book a meeting, preventing double-booking and syncing with Google Calendar if connected.
 */
export async function bookMeeting(
  db: SupabaseClient,
  args: BookMeetingArgs,
): Promise<BookingResult> {
  const {
    accountId,
    contactId,
    conversationId,
    title,
    description,
    serviceRequested,
    startTime,
    timezone,
    bookingSource = 'whatsapp_ai',
    leadSummary,
    idempotencyKey,
    attendeeEmail,
    attendeeName,
  } = args;

  const settings = await loadSchedulingSettings(db, accountId);

  const start = typeof startTime === 'string' ? new Date(startTime) : startTime;
  const tz = timezone || settings.timezone || 'Asia/Kolkata';

  let end: Date;
  if (args.endTime) {
    end = typeof args.endTime === 'string' ? new Date(args.endTime) : args.endTime;
  } else {
    end = new Date(start.getTime() + settings.meeting_duration_minutes * 60 * 1000);
  }

  // Pre-generate default meeting link if native
  const nativeMeetingLink =
    settings.default_meeting_link ||
    `https://meet.google.com/meet-${Math.random().toString(36).substring(2, 6)}-${Math.random().toString(36).substring(2, 5)}`;

  // 1. Atomic database booking RPC
  const { data: rpcRes, error: rpcErr } = await db.rpc('book_meeting_atomically', {
    p_account_id: accountId,
    p_contact_id: contactId,
    p_conversation_id: conversationId || null,
    p_title: title,
    p_description: description || null,
    p_service_requested: serviceRequested || null,
    p_start_time: start.toISOString(),
    p_end_time: end.toISOString(),
    p_timezone: tz,
    p_meeting_link: nativeMeetingLink,
    p_booking_source: bookingSource,
    p_lead_summary: leadSummary || null,
    p_idempotency_key: idempotencyKey || null,
  });

  if (rpcErr) {
    if (rpcErr.code === '23P01' || rpcErr.message?.includes('meetings_no_overlapping_slots')) {
      return {
        success: false,
        error: 'SLOT_UNAVAILABLE',
        message: 'The requested time slot was just booked by another user. Please choose an alternative slot.',
      };
    }
    console.error('[booking] atomic booking RPC error:', rpcErr);
    return {
      success: false,
      error: 'DATABASE_ERROR',
      message: 'Failed to reserve meeting in database.',
    };
  }

  const result = rpcRes as BookingResult;
  if (!result.success || !result.meeting_id) {
    return result;
  }

  let finalMeetingLink = nativeMeetingLink;
  let calendarProvider: 'native' | 'google_calendar' = 'native';
  let calendarEventId: string | null = null;
  let syncStatus: 'synced' | 'pending' | 'failed' | 'local_only' = 'local_only';

  // 2. Google Calendar sync if enabled
  if (settings.google_calendar_enabled) {
    try {
      const { data: rawTokens } = await db
        .from('scheduling_settings')
        .select('google_calendar_tokens')
        .eq('account_id', accountId)
        .maybeSingle();

      if (rawTokens?.google_calendar_tokens) {
        const tokens = rawTokens.google_calendar_tokens as GoogleCalendarTokens;
        const validToken = await getValidAccessToken(tokens);

        if (validToken) {
          const gEvent = await createGoogleCalendarEvent(validToken, {
            title,
            description: `${description || ''}\n\nLead Summary:\n${leadSummary || 'N/A'}\nService: ${serviceRequested || 'General Discovery'}`,
            startTime: start.toISOString(),
            endTime: end.toISOString(),
            timezone: tz,
            attendeeEmail,
            attendeeName,
          });

          if (gEvent) {
            calendarProvider = 'google_calendar';
            calendarEventId = gEvent.eventId;
            syncStatus = 'synced';
            if (gEvent.meetLink) {
              finalMeetingLink = gEvent.meetLink;
            }
          } else {
            syncStatus = 'failed';
          }
        }
      }
    } catch (gErr) {
      console.warn('[booking] Google Calendar sync exception (continuing native):', gErr);
      syncStatus = 'failed';
    }
  }

  // Update meeting with final calendar metadata
  await db
    .from('meetings')
    .update({
      meeting_link: finalMeetingLink,
      calendar_provider: calendarProvider,
      calendar_event_id: calendarEventId,
      calendar_sync_status: syncStatus,
      status: 'confirmed',
    })
    .eq('id', result.meeting_id);

  return {
    success: true,
    meeting_id: result.meeting_id,
    status: 'confirmed',
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    meeting_link: finalMeetingLink,
    is_idempotent_replay: result.is_idempotent_replay,
  };
}

/**
 * Reschedule an existing meeting to a new time slot.
 */
export async function rescheduleMeeting(
  db: SupabaseClient,
  args: RescheduleMeetingArgs,
): Promise<{ success: boolean; error?: string; meeting?: Meeting }> {
  const { meetingId, accountId, newStartTime, newEndTime, timezone, rescheduleReason } = args;

  const { data: meeting, error: mErr } = await db
    .from('meetings')
    .select('*')
    .eq('id', meetingId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (mErr || !meeting) {
    return { success: false, error: 'Meeting not found' };
  }

  const start = typeof newStartTime === 'string' ? new Date(newStartTime) : newStartTime;
  let end: Date;
  if (newEndTime) {
    end = typeof newEndTime === 'string' ? new Date(newEndTime) : newEndTime;
  } else {
    end = new Date(start.getTime() + (meeting.duration_minutes || 15) * 60 * 1000);
  }

  // Verify availability excluding this meeting
  const { data: isAvail } = await db.rpc('is_slot_available', {
    p_account_id: accountId,
    p_start_time: start.toISOString(),
    p_end_time: end.toISOString(),
    p_exclude_meeting_id: meetingId,
  });

  if (!isAvail) {
    return {
      success: false,
      error: 'The requested reschedule slot is not available. Please choose another time.',
    };
  }

  // Update meeting in DB
  const { data: updated, error: uErr } = await db
    .from('meetings')
    .update({
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      timezone: timezone || meeting.timezone,
      status: 'rescheduled',
      metadata: {
        ...(meeting.metadata || {}),
        rescheduled_from: meeting.start_time,
        rescheduled_at: new Date().toISOString(),
        reschedule_reason: rescheduleReason || null,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', meetingId)
    .select()
    .single();

  if (uErr) {
    return { success: false, error: uErr.message };
  }

  // Update AI qualification record if tied to a conversation
  if (meeting.conversation_id) {
    await db
      .from('ai_lead_qualifications')
      .update({
        selected_slot: start.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('conversation_id', meeting.conversation_id);
  }

  return { success: true, meeting: updated };
}

/**
 * Cancel a meeting.
 */
export async function cancelMeeting(
  db: SupabaseClient,
  args: CancelMeetingArgs,
): Promise<{ success: boolean; error?: string }> {
  const { meetingId, accountId, reason } = args;

  const { data: meeting, error: mErr } = await db
    .from('meetings')
    .select('*')
    .eq('id', meetingId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (mErr || !meeting) {
    return { success: false, error: 'Meeting not found' };
  }

  // Update meeting status
  const { error: uErr } = await db
    .from('meetings')
    .update({
      status: 'cancelled',
      cancellation_reason: reason || 'Cancelled by user / customer',
      updated_at: new Date().toISOString(),
    })
    .eq('id', meetingId);

  if (uErr) {
    return { success: false, error: uErr.message };
  }

  // Clean up Google Calendar event if exists
  if (meeting.calendar_event_id && meeting.calendar_provider === 'google_calendar') {
    try {
      const { data: rawTokens } = await db
        .from('scheduling_settings')
        .select('google_calendar_tokens')
        .eq('account_id', accountId)
        .maybeSingle();

      if (rawTokens?.google_calendar_tokens) {
        const tokens = rawTokens.google_calendar_tokens as GoogleCalendarTokens;
        const validToken = await getValidAccessToken(tokens);
        if (validToken) {
          await deleteGoogleCalendarEvent(validToken, meeting.calendar_event_id);
        }
      }
    } catch (gErr) {
      console.warn('[booking] Google Calendar delete failed (ignoring):', gErr);
    }
  }

  // Update qualification state
  if (meeting.conversation_id) {
    await db
      .from('ai_lead_qualifications')
      .update({
        state: 'MEETING_CANCELLED',
        updated_at: new Date().toISOString(),
      })
      .eq('conversation_id', meeting.conversation_id);
  }

  return { success: true };
}
