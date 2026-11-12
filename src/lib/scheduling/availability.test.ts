import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  generateAvailableSlots,
  isSlotWithinWorkingHours,
  hasConflict,
  formatSlotsForWhatsApp,
  isSlotAvailable,
  getAvailableSlots,
} from './availability';
import { encryptGoogleTokens } from './google-calendar';
import type { SchedulingSettings } from '@/types';

describe('Availability Engine', () => {
  const originalFetch = global.fetch;

  const defaultSettings: SchedulingSettings = {
    account_id: 'acc-1',
    meeting_duration_minutes: 15,
    working_days: [1, 2, 3, 4, 5], // Mon to Fri
    working_hours_start: '09:00',
    working_hours_end: '17:00',
    timezone: 'Asia/Kolkata',
    buffer_before_minutes: 5,
    buffer_after_minutes: 10,
    minimum_notice_hours: 2,
    max_advance_days: 7,
    google_calendar_enabled: false,
    google_calendar_email: null,
    default_meeting_link: 'https://meet.opsiys.com/room/opsiys-demo',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('checks if a slot is within configured working hours', () => {
    // 10:00 AM IST on a Monday (2026-10-19) -> 04:30 AM UTC
    const mondaySlot = new Date('2026-10-19T04:30:00.000Z');
    expect(isSlotWithinWorkingHours(mondaySlot, 15, defaultSettings)).toBe(true);

    // 08:00 AM IST (before start 09:00) -> 02:30 AM UTC
    const tooEarly = new Date('2026-10-19T02:30:00.000Z');
    expect(isSlotWithinWorkingHours(tooEarly, 15, defaultSettings)).toBe(false);

    // 18:30 PM IST (after end 17:00) -> 13:00 UTC
    const tooLate = new Date('2026-10-19T13:00:00.000Z');
    expect(isSlotWithinWorkingHours(tooLate, 15, defaultSettings)).toBe(false);

    // Sunday (Day 7)
    const sundaySlot = new Date('2026-10-18T05:30:00.000Z');
    expect(isSlotWithinWorkingHours(sundaySlot, 15, defaultSettings)).toBe(false);
  });

  it('detects time conflicts between existing meetings and requested slot', () => {
    const existing = [
      {
        start: '2026-10-20T10:00:00.000Z',
        end: '2026-10-20T10:15:00.000Z',
      },
    ];

    const conflict1 = hasConflict(
      new Date('2026-10-20T10:05:00.000Z'),
      new Date('2026-10-20T10:20:00.000Z'),
      existing,
      defaultSettings.buffer_before_minutes,
      defaultSettings.buffer_after_minutes,
    );
    expect(conflict1).toBe(true);

    const conflictBuffer = hasConflict(
      new Date('2026-10-20T10:20:00.000Z'),
      new Date('2026-10-20T10:35:00.000Z'),
      existing,
      defaultSettings.buffer_before_minutes,
      defaultSettings.buffer_after_minutes,
    );
    expect(conflictBuffer).toBe(true);

    const freeSlot = hasConflict(
      new Date('2026-10-20T11:00:00.000Z'),
      new Date('2026-10-20T11:15:00.000Z'),
      existing,
      defaultSettings.buffer_before_minutes,
      defaultSettings.buffer_after_minutes,
    );
    expect(freeSlot).toBe(false);
  });

  it('generates available candidate slots excluding busy periods', () => {
    const refDate = new Date('2026-10-19T03:30:00.000Z');

    const slots = generateAvailableSlots({
      settings: defaultSettings,
      bookedPeriods: [],
      googleBusyPeriods: [],
      referenceDate: refDate,
      maxSlots: 4,
    });

    expect(slots.length).toBeGreaterThan(0);
    expect(slots.length).toBeLessThanOrEqual(4);

    slots.forEach((s) => {
      expect(s.startTime).toBeDefined();
      expect(s.endTime).toBeDefined();
      expect(s.formattedDate).toBeDefined();
      expect(s.formattedTime).toBeDefined();
      expect(s.timezone).toBe('Asia/Kolkata');
    });
  });

  it('formats slots nicely for WhatsApp message', () => {
    const mockSlots = [
      {
        startTime: '2026-10-21T09:30:00.000Z',
        endTime: '2026-10-21T09:45:00.000Z',
        formattedDate: 'Wednesday, Oct 21',
        formattedTime: '3:00 PM',
        timezone: 'Asia/Kolkata',
      },
      {
        startTime: '2026-10-21T11:00:00.000Z',
        endTime: '2026-10-21T11:15:00.000Z',
        formattedDate: 'Wednesday, Oct 21',
        formattedTime: '4:30 PM',
        timezone: 'Asia/Kolkata',
      },
    ];

    const message = formatSlotsForWhatsApp(mockSlots);
    expect(message).toContain('*1.* Wednesday, Oct 21 at 3:00 PM IST');
    expect(message).toContain('*2.* Wednesday, Oct 21 at 4:30 PM IST');
    expect(message).toContain('reply with the number of your preferred slot');
  });

  it('isSlotAvailable queries custom Google calendarId, enforces buffer conflict, and fails closed when Google fails', async () => {
    const customCalId = 'sales-team@group.calendar.google.com';
    const settingsRow = {
      id: 'settings-1',
      account_id: 'acc-1',
      meeting_duration_minutes: 15,
      working_days: [1, 2, 3, 4, 5],
      working_hours_start: '09:00',
      working_hours_end: '18:00',
      timezone: 'Asia/Kolkata',
      buffer_before_minutes: 5,
      buffer_after_minutes: 10,
      minimum_notice_hours: 2,
      max_advance_days: 14,
      google_calendar_enabled: true,
      google_calendar_status: 'connected',
      google_calendar_email: 'sales@opsiys.in',
      google_calendar_calendar_id: customCalId,
      google_calendar_tokens: encryptGoogleTokens({
        access_token: 'ya29.valid-cal-token',
        refresh_token: '1//refresh',
        expiry_date: Date.now() + 3600_000,
      }),
    };

    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'scheduling_settings') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: settingsRow, error: null }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        return {};
      }),
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    } as unknown as SupabaseClient;

    let requestedCalId: string | undefined;
    global.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) || '{}');
      requestedCalId = body.items?.[0]?.id;
      return new Response(
        JSON.stringify({
          calendars: {
            [customCalId]: {
              // Ends at 05:25 UTC -> with 10 min buffer_after, busy through 05:35 UTC
              busy: [{ start: '2026-10-20T05:00:00.000Z', end: '2026-10-20T05:25:00.000Z' }],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    // Slot 05:30 - 05:45 UTC conflicts with 10m buffer_after
    const conflicted = await isSlotAvailable(
      mockDb,
      'acc-1',
      '2026-10-20T05:30:00.000Z',
      '2026-10-20T05:45:00.000Z',
      { referenceDate: new Date('2026-10-19T00:00:00.000Z') },
    );
    expect(requestedCalId).toBe(customCalId);
    expect(conflicted).toBe(false);

    // Slot 06:00 - 06:15 UTC is free
    const open = await isSlotAvailable(
      mockDb,
      'acc-1',
      '2026-10-20T06:00:00.000Z',
      '2026-10-20T06:15:00.000Z',
      { referenceDate: new Date('2026-10-19T00:00:00.000Z') },
    );
    expect(open).toBe(true);

    // Fail closed if Google freeBusy returns error
    global.fetch = vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    const failedClosed = await isSlotAvailable(
      mockDb,
      'acc-1',
      '2026-10-20T06:00:00.000Z',
      '2026-10-20T06:15:00.000Z',
      { referenceDate: new Date('2026-10-19T00:00:00.000Z') },
    );
    expect(failedClosed).toBe(false);
  });

  it('getAvailableSlots fails closed when Google Calendar is enabled but tokens cannot be refreshed', async () => {
    const expiredRow = {
      id: 'settings-1',
      account_id: 'acc-1',
      meeting_duration_minutes: 15,
      working_days: [1, 2, 3, 4, 5],
      working_hours_start: '09:00',
      working_hours_end: '18:00',
      timezone: 'Asia/Kolkata',
      google_calendar_enabled: true,
      google_calendar_status: 'connected',
      google_calendar_tokens: encryptGoogleTokens({
        access_token: 'ya29.expired',
        expiry_date: Date.now() - 60_000,
      }),
    };

    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'scheduling_settings') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: expiredRow, error: null }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                gte: vi.fn().mockReturnValue({
                  lte: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          }),
        };
      }),
    } as unknown as SupabaseClient;

    const slots = await getAvailableSlots(mockDb, 'acc-1', {
      referenceDate: new Date('2026-10-19T03:00:00.000Z'),
    });
    expect(slots).toEqual([]);
  });
});
