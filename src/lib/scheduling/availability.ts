import type { SupabaseClient } from '@supabase/supabase-js';
import type { SchedulingSettings, TimeSlot } from '@/types/meetings';
import {
  getValidAccessToken,
  queryGoogleBusyPeriods,
  decryptGoogleTokens,
} from './google-calendar';

export const DEFAULT_SCHEDULING_SETTINGS: Omit<SchedulingSettings, 'account_id'> = {
  meeting_duration_minutes: 15,
  working_days: [1, 2, 3, 4, 5], // Monday - Friday
  working_hours_start: '09:00',
  working_hours_end: '18:00',
  timezone: 'Asia/Kolkata',
  buffer_before_minutes: 5,
  buffer_after_minutes: 10,
  minimum_notice_hours: 2,
  max_advance_days: 14,
  google_calendar_enabled: false,
  google_calendar_email: null,
  default_meeting_link: 'https://meet.google.com/new',
};

export const SCHEDULING_SETTINGS_PUBLIC_COLUMNS =
  'id, account_id, meeting_duration_minutes, working_days, working_hours_start, working_hours_end, timezone, buffer_before_minutes, buffer_after_minutes, minimum_notice_hours, max_advance_days, google_calendar_enabled, google_calendar_email, default_meeting_link, created_at, updated_at';

/**
 * Load scheduling settings for an account, creating or returning defaults if missing.
 */
export async function loadSchedulingSettings(
  db: SupabaseClient,
  accountId: string,
): Promise<SchedulingSettings> {
  const { data, error } = await db
    .from('scheduling_settings')
    .select(SCHEDULING_SETTINGS_PUBLIC_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) {
    console.warn('[scheduling] error loading settings, using defaults:', error);
  }

  if (data) {
    return {
      id: data.id,
      account_id: data.account_id,
      meeting_duration_minutes: data.meeting_duration_minutes ?? 15,
      working_days: data.working_days ?? [1, 2, 3, 4, 5],
      working_hours_start: data.working_hours_start ?? '09:00',
      working_hours_end: data.working_hours_end ?? '18:00',
      timezone: data.timezone ?? 'Asia/Kolkata',
      buffer_before_minutes: data.buffer_before_minutes ?? 5,
      buffer_after_minutes: data.buffer_after_minutes ?? 10,
      minimum_notice_hours: data.minimum_notice_hours ?? 2,
      max_advance_days: data.max_advance_days ?? 14,
      google_calendar_enabled: Boolean(data.google_calendar_enabled),
      google_calendar_email: data.google_calendar_email ?? null,
      default_meeting_link: data.default_meeting_link ?? null,
      created_at: data.created_at,
      updated_at: data.updated_at,
    };
  }

  return {
    ...DEFAULT_SCHEDULING_SETTINGS,
    account_id: accountId,
  };
}

/**
 * Generate available time slots for an account for the next N days.
 */
export async function getAvailableSlots(
  db: SupabaseClient,
  accountId: string,
  options: {
    startDate?: Date;
    daysCount?: number;
    limit?: number;
  } = {},
): Promise<TimeSlot[]> {
  const settings = await loadSchedulingSettings(db, accountId);
  const now = new Date();
  const start = options.startDate && options.startDate > now ? options.startDate : now;
  const days = Math.min(options.daysCount || 7, settings.max_advance_days || 14);
  const limit = options.limit || 6;

  // Range for query
  const queryRangeStart = new Date(start);
  queryRangeStart.setHours(0, 0, 0, 0);

  const queryRangeEnd = new Date(start);
  queryRangeEnd.setDate(queryRangeEnd.getDate() + days);
  queryRangeEnd.setHours(23, 59, 59, 999);

  // Fetch existing booked meetings in this range
  let existingMeetings: Array<{ start_time: string; end_time: string }> | null = null;
  try {
    const res = await db
      .from('meetings')
      .select('start_time, end_time')
      .eq('account_id', accountId)
      .in('status', ['scheduled', 'confirmed', 'rescheduled'])
      .gte('end_time', queryRangeStart.toISOString())
      .lte('start_time', queryRangeEnd.toISOString());
    existingMeetings = res.data;
  } catch {
    // Graceful fallback if table or chain is not available in test harness
  }

  const bookedRanges = (existingMeetings || []).map((m: { start_time: string; end_time: string }) => ({
    start: new Date(m.start_time).getTime(),
    end: new Date(m.end_time).getTime(),
  }));

  // Fetch Google Calendar busy periods if enabled
  if (settings.google_calendar_enabled) {
    let tokenDb = db;
    try {
      const { supabaseAdmin } = await import('@/lib/ai/admin-client');
      tokenDb = supabaseAdmin();
    } catch {
      // fallback to db in test environments
    }

    const { data: rawRow } = await tokenDb
      .from('scheduling_settings')
      .select('google_calendar_tokens')
      .eq('account_id', accountId)
      .maybeSingle();

    const tokens = decryptGoogleTokens(rawRow?.google_calendar_tokens);
    if (tokens) {
      const validToken = await getValidAccessToken(tokens);
      if (validToken) {
        const gBusy = await queryGoogleBusyPeriods(
          validToken,
          queryRangeStart.toISOString(),
          queryRangeEnd.toISOString(),
        );
        for (const b of gBusy) {
          bookedRanges.push({
            start: new Date(b.start).getTime(),
            end: new Date(b.end).getTime(),
          });
        }
      }
    }
  }

  const allBusy = [...bookedRanges];

  return generateAvailableSlots({
    settings,
    bookedPeriods: allBusy,
    referenceDate: start,
    daysCount: days,
    maxSlots: limit,
  });
}

/**
 * Check if a slot falls within configured working days and working hours.
 */
export function isSlotWithinWorkingHours(
  slotDate: Date,
  durationMinutes: number,
  settings: SchedulingSettings,
): boolean {
  // Convert slot date to settings timezone string representation
  const dStr = slotDate.toLocaleString('en-US', { timeZone: settings.timezone });
  const localDate = new Date(dStr);

  let dayOfWeek = localDate.getDay();
  if (dayOfWeek === 0) dayOfWeek = 7; // 1=Mon, 7=Sun

  if (!settings.working_days.includes(dayOfWeek)) {
    return false;
  }

  const [startHour, startMin] = settings.working_hours_start.split(':').map(Number);
  const [endHour, endMin] = settings.working_hours_end.split(':').map(Number);

  const slotHour = localDate.getHours();
  const slotMin = localDate.getMinutes();
  const slotTotalMin = slotHour * 60 + slotMin;
  const startTotalMin = startHour * 60 + startMin;
  const endTotalMin = endHour * 60 + endMin;

  return slotTotalMin >= startTotalMin && slotTotalMin + durationMinutes <= endTotalMin;
}

/**
 * Check if a candidate slot conflicts with any existing busy periods (accounting for buffers).
 */
export function hasConflict(
  slotStart: Date,
  slotEnd: Date,
  existingRanges: Array<{ start: string | number; end: string | number }>,
  bufferBeforeMinutes: number = 0,
  bufferAfterMinutes: number = 0,
): boolean {
  const sStart = slotStart.getTime();
  const sEnd = slotEnd.getTime();
  const bBeforeMs = bufferBeforeMinutes * 60 * 1000;
  const bAfterMs = bufferAfterMinutes * 60 * 1000;

  return existingRanges.some((range) => {
    const rStart = typeof range.start === 'string' ? new Date(range.start).getTime() : range.start;
    const rEnd = typeof range.end === 'string' ? new Date(range.end).getTime() : range.end;

    // A conflict occurs if the candidate slot overlaps with the existing meeting PLUS its surrounding buffer
    const busyStart = rStart - bBeforeMs;
    const busyEnd = rEnd + bAfterMs;

    return sStart < busyEnd && sEnd > busyStart;
  });
}

/**
 * Pure slot generator taking settings and busy periods.
 */
export function generateAvailableSlots(options: {
  settings: SchedulingSettings;
  bookedPeriods?: Array<{ start: string | number; end: string | number }>;
  googleBusyPeriods?: Array<{ start: string | number; end: string | number }>;
  referenceDate?: Date;
  daysCount?: number;
  maxSlots?: number;
}): TimeSlot[] {
  const {
    settings,
    bookedPeriods = [],
    googleBusyPeriods = [],
    referenceDate = new Date(),
    daysCount = 7,
    maxSlots = 6,
  } = options;

  const now = referenceDate;
  const earliestAllowed = new Date(
    now.getTime() + (settings.minimum_notice_hours || 0) * 60 * 60 * 1000
  );

  const [startHour, startMin] = settings.working_hours_start.split(':').map(Number);
  const [endHour, endMin] = settings.working_hours_end.split(':').map(Number);

  const durationMs = settings.meeting_duration_minutes * 60 * 1000;
  const bufferAfterMs = (settings.buffer_after_minutes || 0) * 60 * 1000;
  const totalSlotIntervalMs = durationMs + bufferAfterMs;

  const allBusy = [...bookedPeriods, ...googleBusyPeriods];
  const availableSlots: TimeSlot[] = [];

  for (let d = 0; d < daysCount; d++) {
    if (availableSlots.length >= maxSlots) break;

    const currentDay = new Date(referenceDate);
    currentDay.setDate(currentDay.getDate() + d);

    let dayOfWeek = currentDay.getDay();
    if (dayOfWeek === 0) dayOfWeek = 7;

    if (!settings.working_days.includes(dayOfWeek)) {
      continue;
    }

    const dayStart = new Date(currentDay);
    dayStart.setHours(startHour, startMin, 0, 0);

    const dayEnd = new Date(currentDay);
    dayEnd.setHours(endHour, endMin, 0, 0);

    let currentSlotStart = new Date(dayStart);

    while (currentSlotStart.getTime() + durationMs <= dayEnd.getTime()) {
      if (availableSlots.length >= maxSlots) break;

      const currentSlotEnd = new Date(currentSlotStart.getTime() + durationMs);

      if (currentSlotStart.getTime() >= earliestAllowed.getTime()) {
        const conflict = hasConflict(
          currentSlotStart,
          currentSlotEnd,
          allBusy,
          settings.buffer_before_minutes || 0,
          settings.buffer_after_minutes || 0
        );

        if (!conflict) {
          availableSlots.push({
            startTime: currentSlotStart.toISOString(),
            endTime: currentSlotEnd.toISOString(),
            formattedDate: formatDatePretty(currentSlotStart),
            formattedTime: formatTimePretty(currentSlotStart),
            timezone: settings.timezone,
          });
        }
      }

      currentSlotStart = new Date(currentSlotStart.getTime() + totalSlotIntervalMs);
    }
  }

  return availableSlots;
}

/**
 * Verify whether a specific slot is free for an account.
 */
export async function isSlotAvailable(
  db: SupabaseClient,
  accountId: string,
  startTime: Date | string,
  endTime: Date | string,
  excludeMeetingId?: string,
): Promise<boolean> {
  const startIso = typeof startTime === 'string' ? startTime : startTime.toISOString();
  const endIso = typeof endTime === 'string' ? endTime : endTime.toISOString();

  const { data, error } = await db.rpc('is_slot_available', {
    p_account_id: accountId,
    p_start_time: startIso,
    p_end_time: endIso,
    p_exclude_meeting_id: excludeMeetingId || null,
  });

  if (error) {
    console.error('[scheduling] is_slot_available RPC error:', error);
    return false;
  }

  return Boolean(data);
}

/**
 * Format a list of TimeSlots into a friendly WhatsApp message bullet list.
 */
export function formatSlotsForWhatsApp(slots: TimeSlot[]): string {
  if (slots.length === 0) {
    return 'No slots available in the next few days. Please let us know a custom time that suits you.';
  }

  const list = slots
    .map(
      (slot, index) =>
        `*${index + 1}.* ${slot.formattedDate} at ${slot.formattedTime} ${slot.timezone === 'Asia/Kolkata' ? 'IST' : `(${slot.timezone})`}`
    )
    .join('\n');

  return `${list}\n\nPlease reply with the number of your preferred slot, or suggest another time that works for you!`;
}

function formatDatePretty(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatTimePretty(d: Date): string {
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
