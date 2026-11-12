import type { SupabaseClient } from '@supabase/supabase-js';
import type { SchedulingSettings, TimeSlot } from '@/types/meetings';
import {
  getValidAccessTokenForAccount,
  queryGoogleBusyPeriods,
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
  google_calendar_status: 'disconnected',
  google_calendar_account_id: null,
  google_calendar_calendar_id: 'primary',
  default_meeting_link: 'https://meet.google.com/new',
};

export const SCHEDULING_SETTINGS_PUBLIC_COLUMNS =
  'id, account_id, meeting_duration_minutes, working_days, working_hours_start, working_hours_end, timezone, buffer_before_minutes, buffer_after_minutes, minimum_notice_hours, max_advance_days, google_calendar_enabled, google_calendar_email, google_calendar_status, google_calendar_account_id, google_calendar_calendar_id, default_meeting_link, created_at, updated_at';

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
      google_calendar_status:
        (data.google_calendar_status as SchedulingSettings['google_calendar_status']) ||
        (data.google_calendar_enabled ? 'connected' : 'disconnected'),
      google_calendar_account_id: data.google_calendar_account_id ?? null,
      google_calendar_calendar_id: data.google_calendar_calendar_id ?? 'primary',
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
    referenceDate?: Date;
  } = {},
): Promise<TimeSlot[]> {
  const settings = await loadSchedulingSettings(db, accountId);
  const now = options.referenceDate || new Date();
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

    const validToken = await getValidAccessTokenForAccount(tokenDb, accountId).catch(() => null);
    if (!validToken) {
      console.warn(
        `[scheduling] Google Calendar is enabled for account ${accountId} but no valid access token could be obtained.`,
      );
      return [];
    }

    const gBusyRes = await queryGoogleBusyPeriods(
      validToken,
      queryRangeStart.toISOString(),
      queryRangeEnd.toISOString(),
      settings.google_calendar_calendar_id || 'primary',
    );

    if (!gBusyRes.success) {
      console.warn(
        `[scheduling] Google Calendar freeBusy query failed for account ${accountId}: ${gBusyRes.error}`,
      );
      return [];
    }

    for (const b of gBusyRes.busy) {
      bookedRanges.push({
        start: new Date(b.start).getTime(),
        end: new Date(b.end).getTime(),
      });
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
 * Helper: Extract year, month, day, weekday, hour, minute in a specified timezone.
 */
export interface ZonedDateParts {
  year: number;
  month: number; // 1-12
  day: number;
  weekday: string; // 'Mon', 'Tue', etc.
  hour: number;
  minute: number;
  second: number;
}

export function getZonedParts(date: Date, timeZone: string = 'Asia/Kolkata'): ZonedDateParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }
  let hour = parseInt(map.hour || '0', 10);
  if (hour === 24) hour = 0;
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    weekday: map.weekday || 'Mon',
    hour,
    minute: parseInt(map.minute || '0', 10),
    second: parseInt(map.second || '0', 10),
  };
}

/**
 * Helper: Convert a target calendar time in a specific timezone to a UTC Date.
 */
export function zonedTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  second: number = 0,
  timeZone: string = 'Asia/Kolkata',
): Date {
  const desiredUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const approx = new Date(desiredUtcMs);
  const p1 = getZonedParts(approx, timeZone);
  const p1Ms = Date.UTC(p1.year, p1.month - 1, p1.day, p1.hour, p1.minute, p1.second);
  const offsetMs = p1Ms - desiredUtcMs;
  let exact = new Date(approx.getTime() - offsetMs);

  // DST boundary check
  const p2 = getZonedParts(exact, timeZone);
  const p2Ms = Date.UTC(p2.year, p2.month - 1, p2.day, p2.hour, p2.minute, p2.second);
  if (p2Ms !== desiredUtcMs) {
    exact = new Date(exact.getTime() - (p2Ms - desiredUtcMs));
  }
  return exact;
}

/**
 * Check if a slot falls within configured working days and working hours in the business timezone.
 */
export function isSlotWithinWorkingHours(
  slotDate: Date,
  durationMinutes: number,
  settings: SchedulingSettings,
): boolean {
  const tz = settings.timezone || 'Asia/Kolkata';
  const parts = getZonedParts(slotDate, tz);

  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  const dayOfWeek = weekdayMap[parts.weekday] ?? 1;

  if (!settings.working_days.includes(dayOfWeek)) {
    return false;
  }

  const [startHour, startMin] = settings.working_hours_start.split(':').map(Number);
  const [endHour, endMin] = settings.working_hours_end.split(':').map(Number);

  const slotTotalMin = parts.hour * 60 + parts.minute;
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
 * Uses business timezone to construct days and excludes past slots.
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

  const tz = settings.timezone || 'Asia/Kolkata';
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

  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };

  const zonedNow = getZonedParts(now, tz);

  for (let d = 0; d < daysCount; d++) {
    if (availableSlots.length >= maxSlots) break;

    // Advance calendar day in the target timezone
    const baseDay = new Date(Date.UTC(zonedNow.year, zonedNow.month - 1, zonedNow.day + d, 12, 0, 0));
    const dayParts = getZonedParts(baseDay, tz);
    const dayOfWeek = weekdayMap[dayParts.weekday] ?? 1;

    if (!settings.working_days.includes(dayOfWeek)) {
      continue;
    }

    const dayStartUtc = zonedTimeToUtc(
      dayParts.year,
      dayParts.month,
      dayParts.day,
      startHour,
      startMin,
      0,
      tz
    );
    const dayEndUtc = zonedTimeToUtc(
      dayParts.year,
      dayParts.month,
      dayParts.day,
      endHour,
      endMin,
      0,
      tz
    );

    let currentSlotStart = new Date(dayStartUtc);

    while (currentSlotStart.getTime() + durationMs <= dayEndUtc.getTime()) {
      if (availableSlots.length >= maxSlots) break;

      const currentSlotEnd = new Date(currentSlotStart.getTime() + durationMs);

      // Must be strictly after current time plus minimum notice (never at or before)
      if (currentSlotStart.getTime() > earliestAllowed.getTime()) {
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
            formattedDate: formatDatePretty(currentSlotStart, tz),
            formattedTime: formatTimePretty(currentSlotStart, tz),
            timezone: tz,
          });
        }
      }

      currentSlotStart = new Date(currentSlotStart.getTime() + totalSlotIntervalMs);
    }
  }

  return availableSlots;
}

/**
 * Verify whether a specific slot is free for an account, checking:
 * 1. Not in the past
 * 2. Within working hours and working days
 * 3. Not overlapping with Google Calendar (if enabled), including configured buffers
 * 4. Not overlapping with existing database meetings
 */
export async function isSlotAvailable(
  db: SupabaseClient,
  accountId: string,
  startTime: Date | string,
  endTime: Date | string,
  options?: string | {
    excludeMeetingId?: string;
    referenceDate?: Date;
    settings?: SchedulingSettings;
  },
): Promise<boolean> {
  const excludeMeetingId = typeof options === 'string' ? options : options?.excludeMeetingId;
  const referenceDate = typeof options === 'object' ? options?.referenceDate : undefined;
  const passedSettings = typeof options === 'object' ? options?.settings : undefined;

  const start = typeof startTime === 'string' ? new Date(startTime) : startTime;
  const end = typeof endTime === 'string' ? new Date(endTime) : endTime;
  const now = referenceDate || new Date();

  // 1. Slot cannot be at or before now, and end must be after start
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start || start.getTime() <= now.getTime()) {
    return false;
  }

  // 2. Settings check for working hours
  const settings = passedSettings || (await loadSchedulingSettings(db, accountId));
  const durationMinutes = Math.round((end.getTime() - start.getTime()) / (60 * 1000));
  if (!isSlotWithinWorkingHours(start, durationMinutes, settings)) {
    return false;
  }

  // 3. Google Calendar check if enabled
  if (settings.google_calendar_enabled) {
    let tokenDb = db;
    try {
      const { supabaseAdmin } = await import('@/lib/ai/admin-client');
      tokenDb = supabaseAdmin();
    } catch {
      // test fallback
    }

    const validToken = await getValidAccessTokenForAccount(tokenDb, accountId).catch(() => null);
    if (!validToken) {
      return false;
    }

    const bufferBeforeMs = (settings.buffer_before_minutes || 0) * 60 * 1000;
    const bufferAfterMs = (settings.buffer_after_minutes || 0) * 60 * 1000;
    const checkMin = new Date(start.getTime() - bufferAfterMs).toISOString();
    const checkMax = new Date(end.getTime() + bufferBeforeMs).toISOString();

    const gRes = await queryGoogleBusyPeriods(
      validToken,
      checkMin,
      checkMax,
      settings.google_calendar_calendar_id || 'primary',
    );
    if (!gRes.success) {
      return false;
    }
    if (
      hasConflict(
        start,
        end,
        gRes.busy,
        settings.buffer_before_minutes || 0,
        settings.buffer_after_minutes || 0,
      )
    ) {
      return false;
    }
  }

  const startIso = start.toISOString();
  const endIso = end.toISOString();

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
    return 'We do not have any open slots in the next few days that match our working hours. Please suggest a preferred date and time, and our team will do our best to accommodate you!';
  }

  const list = slots
    .map(
      (slot, index) =>
        `*${index + 1}.* ${slot.formattedDate} at ${slot.formattedTime} ${slot.timezone === 'Asia/Kolkata' ? 'IST' : `(${slot.timezone})`}`
    )
    .join('\n');

  return `${list}\n\nPlease reply with the number of your preferred slot, or suggest another date and time that works for you!`;
}

export function formatDatePretty(d: Date, timeZone: string = 'Asia/Kolkata'): string {
  return d.toLocaleDateString('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function formatTimePretty(d: Date, timeZone: string = 'Asia/Kolkata'): string {
  return d.toLocaleTimeString('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
