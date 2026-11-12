import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookingResult, Meeting } from '@/types/meetings';
import {
  loadSchedulingSettings,
  isSlotWithinWorkingHours,
  isSlotAvailable,
  hasConflict,
} from './availability';
import {
  createGoogleCalendarEvent,
  updateGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  getValidAccessTokenForAccount,
  queryGoogleBusyPeriods,
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
  referenceDate?: Date;
}

export interface RescheduleMeetingArgs {
  meetingId: string;
  accountId: string;
  newStartTime: Date | string;
  newEndTime?: Date | string;
  timezone?: string;
  rescheduleReason?: string;
  referenceDate?: Date;
}

export interface CancelMeetingArgs {
  meetingId: string;
  accountId: string;
  reason?: string;
}

async function resolveTokenDb(fallbackDb: SupabaseClient): Promise<SupabaseClient> {
  try {
    const { supabaseAdmin } = await import('@/lib/ai/admin-client');
    return supabaseAdmin();
  } catch {
    return fallbackDb;
  }
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
    referenceDate,
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

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return {
      success: false,
      error: 'INVALID_TIME_RANGE',
      message: 'The requested meeting start and end times are invalid.',
    };
  }

  // 0. Pre-validate: slot cannot be in the past
  const now = referenceDate || new Date();
  if (start.getTime() <= now.getTime()) {
    return {
      success: false,
      error: 'SLOT_IN_PAST',
      message: 'The requested time slot has already passed. Please select a future time slot.',
    };
  }

  // 0b. Pre-validate: slot must fit within configured working hours
  const durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
  if (!isSlotWithinWorkingHours(start, durationMinutes, settings)) {
    return {
      success: false,
      error: 'OUTSIDE_WORKING_HOURS',
      message: 'The requested time slot falls outside configured working hours.',
    };
  }

  // 0c. Pre-validate Google Calendar conflict if connected & reachable
  const calendarId = settings.google_calendar_calendar_id || 'primary';
  let prefetchedToken: string | null = null;
  let tokenLookupFailed = false;

  if (settings.google_calendar_enabled) {
    const tokenDb = await resolveTokenDb(db);
    prefetchedToken = await getValidAccessTokenForAccount(tokenDb, accountId).catch(() => null);
    if (!prefetchedToken) {
      tokenLookupFailed = true;
    } else {
      const bufferBeforeMs = (settings.buffer_before_minutes || 0) * 60 * 1000;
      const bufferAfterMs = (settings.buffer_after_minutes || 0) * 60 * 1000;
      const gBusy = await queryGoogleBusyPeriods(
        prefetchedToken,
        new Date(start.getTime() - bufferAfterMs).toISOString(),
        new Date(end.getTime() + bufferBeforeMs).toISOString(),
        calendarId,
      );
      if (
        gBusy.success &&
        hasConflict(
          start,
          end,
          gBusy.busy,
          settings.buffer_before_minutes || 0,
          settings.buffer_after_minutes || 0,
        )
      ) {
        return {
          success: false,
          error: 'SLOT_UNAVAILABLE',
          message: 'The requested time slot conflicts with an existing Google Calendar event. Please choose another time.',
        };
      }
    }
  }

  // Honest meeting link resolution:
  // If native booking (no Google Calendar), only use explicitly configured default_meeting_link.
  const nativeMeetingLink = settings.default_meeting_link || null;

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

  // Guard against duplicate Google Calendar event creation on idempotent replay
  if (result.is_idempotent_replay) {
    return {
      ...result,
      success: true,
      meeting_id: result.meeting_id,
      status: result.status || 'confirmed',
      start_time: result.start_time || start.toISOString(),
      end_time: result.end_time || end.toISOString(),
      meeting_link: result.meeting_link ?? nativeMeetingLink,
      is_idempotent_replay: true,
    };
  }

  let finalMeetingLink = nativeMeetingLink;
  let calendarProvider: 'native' | 'google_calendar' = 'native';
  let calendarEventId: string | null = null;
  let syncStatus: 'synced' | 'pending' | 'failed' | 'local_only' = 'local_only';
  const extraMetadata: Record<string, unknown> = {};

  // 2. Google Calendar sync if enabled
  if (settings.google_calendar_enabled) {
    try {
      if (tokenLookupFailed || !prefetchedToken) {
        syncStatus = 'failed';
        extraMetadata.calendar_sync_error = 'Google Calendar authorization expired or unavailable';
      } else {
        const gEvent = await createGoogleCalendarEvent(
          prefetchedToken,
          {
            title,
            description: `${description || ''}\n\nLead Summary:\n${leadSummary || 'N/A'}\nService: ${serviceRequested || 'General Discovery'}`,
            startTime: start.toISOString(),
            endTime: end.toISOString(),
            timezone: tz,
            attendeeEmail,
            attendeeName,
          },
          calendarId,
        );

        if (gEvent) {
          calendarProvider = 'google_calendar';
          calendarEventId = gEvent.eventId;
          syncStatus = 'synced';
          extraMetadata.calendar_id = calendarId;
          if (gEvent.meetLink) {
            finalMeetingLink = gEvent.meetLink;
          }
        } else {
          syncStatus = 'failed';
          extraMetadata.calendar_sync_error = 'Failed to create Google Calendar event';
        }
      }
    } catch (gErr) {
      console.warn('[booking] Google Calendar sync exception (continuing native):', gErr);
      syncStatus = 'failed';
      extraMetadata.calendar_sync_error =
        gErr instanceof Error ? gErr.message : 'Google Calendar sync exception';
    }
  }

  // Update meeting with final calendar metadata (preserving any existing metadata)
  const updatePayload: Record<string, unknown> = {
    meeting_link: finalMeetingLink,
    calendar_provider: calendarProvider,
    calendar_event_id: calendarEventId,
    calendar_sync_status: syncStatus,
    status: 'confirmed',
  };
  if (Object.keys(extraMetadata).length > 0) {
    updatePayload.metadata = extraMetadata;
  }

  await db
    .from('meetings')
    .update(updatePayload)
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
 * Checks past-time, working hours, Google Calendar busy intervals, and DB overlap,
 * then updates both the local meeting record and any linked Google Calendar event.
 */
export async function rescheduleMeeting(
  db: SupabaseClient,
  args: RescheduleMeetingArgs,
): Promise<{ success: boolean; error?: string; meeting?: Meeting }> {
  const { meetingId, accountId, newStartTime, newEndTime, timezone, rescheduleReason, referenceDate } = args;

  const { data: meeting, error: mErr } = await db
    .from('meetings')
    .select('*')
    .eq('id', meetingId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (mErr || !meeting) {
    return { success: false, error: 'Meeting not found' };
  }

  if (meeting.status === 'cancelled' || meeting.status === 'completed') {
    return {
      success: false,
      error: `Cannot reschedule a ${meeting.status} meeting.`,
    };
  }

  const start = typeof newStartTime === 'string' ? new Date(newStartTime) : newStartTime;
  let end: Date;
  if (newEndTime) {
    end = typeof newEndTime === 'string' ? new Date(newEndTime) : newEndTime;
  } else {
    end = new Date(start.getTime() + (meeting.duration_minutes || 15) * 60 * 1000);
  }

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return { success: false, error: 'Invalid reschedule start or end time.' };
  }

  const settings = await loadSchedulingSettings(db, accountId);

  // Verify availability across working hours, Google Calendar, and database excluding this meeting
  const isAvail = await isSlotAvailable(db, accountId, start, end, {
    excludeMeetingId: meetingId,
    referenceDate,
    settings,
  });

  if (!isAvail) {
    return {
      success: false,
      error: 'The requested reschedule slot is not available. Please choose another time.',
    };
  }

  const targetTimezone = timezone || meeting.timezone || settings.timezone || 'Asia/Kolkata';

  // Sync reschedule with Google Calendar if this meeting is linked to a Google Calendar event
  let syncStatus: Meeting['calendar_sync_status'] = meeting.calendar_sync_status || 'local_only';
  let syncedMeetLink: string | null = meeting.meeting_link || null;
  let syncErrorMsg: string | undefined;

  if (meeting.calendar_event_id && meeting.calendar_provider === 'google_calendar') {
    try {
      const tokenDb = await resolveTokenDb(db);
      const validToken = await getValidAccessTokenForAccount(tokenDb, accountId).catch(() => null);
      if (!validToken) {
        syncStatus = 'failed';
        syncErrorMsg = 'Google Calendar authorization expired or unavailable during reschedule';
      } else {
        const calId =
          typeof meeting.metadata?.calendar_id === 'string'
            ? meeting.metadata.calendar_id
            : settings.google_calendar_calendar_id || 'primary';

        const gUpdated = await updateGoogleCalendarEvent(
          validToken,
          meeting.calendar_event_id,
          {
            startTime: start.toISOString(),
            endTime: end.toISOString(),
            timezone: targetTimezone,
            title: meeting.title,
            description: meeting.description || undefined,
          },
          calId,
        );

        if (gUpdated) {
          syncStatus = 'synced';
          if (gUpdated.meetLink && !syncedMeetLink) {
            syncedMeetLink = gUpdated.meetLink;
          }
        } else {
          syncStatus = 'failed';
          syncErrorMsg = 'Failed to update Google Calendar event';
        }
      }
    } catch (gErr) {
      syncStatus = 'failed';
      syncErrorMsg = gErr instanceof Error ? gErr.message : 'Google Calendar update exception';
    }
  }

  const updatedMetadata: Record<string, unknown> = {
    ...(meeting.metadata || {}),
    rescheduled_from: meeting.start_time,
    rescheduled_at: new Date().toISOString(),
    reschedule_reason: rescheduleReason || null,
  };
  if (syncErrorMsg) {
    updatedMetadata.calendar_sync_error = syncErrorMsg;
  } else {
    delete updatedMetadata.calendar_sync_error;
  }

  // Update meeting in DB preserving local history even if Google Calendar sync failed
  const { data: updated, error: uErr } = await db
    .from('meetings')
    .update({
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      timezone: targetTimezone,
      status: 'rescheduled',
      meeting_link: syncedMeetLink,
      calendar_sync_status: syncStatus,
      metadata: updatedMetadata,
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
 * Cancel a meeting while preserving local database history and removing any linked Google Calendar event.
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

  // Update local meeting status first so local history is preserved
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
    let deleteSucceeded = false;
    try {
      const tokenDb = await resolveTokenDb(db);
      const validToken = await getValidAccessTokenForAccount(tokenDb, accountId).catch(() => null);
      if (validToken) {
        const settings = await loadSchedulingSettings(db, accountId).catch(() => null);
        const calId =
          typeof meeting.metadata?.calendar_id === 'string'
            ? meeting.metadata.calendar_id
            : settings?.google_calendar_calendar_id || 'primary';
        deleteSucceeded = await deleteGoogleCalendarEvent(validToken, meeting.calendar_event_id, calId);
      }
    } catch (gErr) {
      console.warn('[booking] Google Calendar delete failed (preserving local cancellation):', gErr);
      deleteSucceeded = false;
    }

    if (!deleteSucceeded) {
      await db
        .from('meetings')
        .update({
          calendar_sync_status: 'failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', meetingId);
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
