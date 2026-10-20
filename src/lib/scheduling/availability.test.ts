import { describe, expect, it } from 'vitest';
import {
  generateAvailableSlots,
  isSlotWithinWorkingHours,
  hasConflict,
  formatSlotsForWhatsApp,
} from './availability';
import type { SchedulingSettings } from '@/types';

describe('Availability Engine', () => {
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

  it('checks if a slot is within configured working hours', () => {
    // 10:00 AM IST on a Monday
    // 2026-10-19 is a Monday
    // 10:00 AM IST is 04:30 AM UTC
    const mondaySlot = new Date('2026-10-19T04:30:00.000Z');
    expect(isSlotWithinWorkingHours(mondaySlot, 15, defaultSettings)).toBe(true);

    // 08:00 AM IST (before start 09:00)
    // 08:00 AM IST is 02:30 AM UTC
    const tooEarly = new Date('2026-10-19T02:30:00.000Z');
    expect(isSlotWithinWorkingHours(tooEarly, 15, defaultSettings)).toBe(false);

    // 18:30 PM IST (after end 17:00)
    // 18:30 PM IST is 13:00 UTC
    const tooLate = new Date('2026-10-19T13:00:00.000Z');
    expect(isSlotWithinWorkingHours(tooLate, 15, defaultSettings)).toBe(false);

    // Sunday (Day 0 / 7)
    // 2026-10-18 is Sunday
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

    // Overlapping slot: 10:05 to 10:20
    const conflict1 = hasConflict(
      new Date('2026-10-20T10:05:00.000Z'),
      new Date('2026-10-20T10:20:00.000Z'),
      existing,
      defaultSettings.buffer_before_minutes,
      defaultSettings.buffer_after_minutes
    );
    expect(conflict1).toBe(true);

    // Slot infringing on buffer after (meeting ends at 10:15, buffer is 10 mins so busy until 10:25)
    const conflictBuffer = hasConflict(
      new Date('2026-10-20T10:20:00.000Z'),
      new Date('2026-10-20T10:35:00.000Z'),
      existing,
      defaultSettings.buffer_before_minutes,
      defaultSettings.buffer_after_minutes
    );
    expect(conflictBuffer).toBe(true);

    // Free slot well outside: 11:00 to 11:15
    const freeSlot = hasConflict(
      new Date('2026-10-20T11:00:00.000Z'),
      new Date('2026-10-20T11:15:00.000Z'),
      existing,
      defaultSettings.buffer_before_minutes,
      defaultSettings.buffer_after_minutes
    );
    expect(freeSlot).toBe(false);
  });

  it('generates available candidate slots excluding busy periods', () => {
    // Reference date: Monday 2026-10-19 09:00 IST (03:30 UTC)
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

    // Each slot should have proper formatting
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
});
