import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bookMeeting, rescheduleMeeting, cancelMeeting } from './booking';
import { encryptGoogleTokens } from './google-calendar';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('Booking Engine & Concurrency Safety', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('calls book_meeting_atomically RPC and returns meeting details on success', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        success: true,
        meeting_id: 'mock-meeting-123',
        status: 'confirmed',
        start_time: '2026-10-21T10:00:00.000Z',
        end_time: '2026-10-21T10:15:00.000Z',
        timezone: 'Asia/Kolkata',
      },
      error: null,
    });

    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: true, error: null }),
    });

    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'scheduling_settings') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    account_id: 'acc-1',
                    meeting_duration_minutes: 15,
                    timezone: 'Asia/Kolkata',
                    google_calendar_enabled: false,
                  },
                }),
              }),
            }),
          };
        }
        return {
          update: mockUpdate,
        };
      }),
      rpc: mockRpc,
    } as unknown as SupabaseClient;

    const result = await bookMeeting(mockDb, {
      accountId: 'acc-1',
      contactId: 'contact-1',
      conversationId: 'conv-1',
      title: 'OPSIYS AI Automation Discovery',
      serviceRequested: 'AI Automation',
      startTime: '2026-10-21T10:00:00.000Z',
      timezone: 'Asia/Kolkata',
      bookingSource: 'whatsapp_ai',
      referenceDate: new Date('2026-10-21T08:00:00.000Z'),
    });

    expect(result.success).toBe(true);
    expect(result.meeting_id).toBe('mock-meeting-123');
    expect(mockRpc).toHaveBeenCalledWith(
      'book_meeting_atomically',
      expect.objectContaining({
        p_account_id: 'acc-1',
        p_contact_id: 'contact-1',
        p_title: 'OPSIYS AI Automation Discovery',
      }),
    );
  });

  it('safely handles double-booking rejection from the atomic database RPC', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        success: false,
        error: 'SLOT_UNAVAILABLE',
        message: 'This time slot is already booked or conflicts with another meeting.',
      },
      error: null,
    });

    const mockDb = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                account_id: 'acc-1',
                meeting_duration_minutes: 15,
                timezone: 'Asia/Kolkata',
                google_calendar_enabled: false,
              },
            }),
          }),
        }),
      }),
      rpc: mockRpc,
    } as unknown as SupabaseClient;

    const result = await bookMeeting(mockDb, {
      accountId: 'acc-1',
      contactId: 'contact-1',
      title: 'OPSIYS Discovery Meeting',
      startTime: '2026-10-21T10:00:00.000Z',
      referenceDate: new Date('2026-10-21T08:00:00.000Z'),
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('SLOT_UNAVAILABLE');
    expect(result.message).toContain('already booked');
  });

  it('safely maps PostgreSQL exclusion constraint error 23P01 directly to SLOT_UNAVAILABLE', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: '23P01',
        message: 'conflicting key value violates exclusion constraint "meetings_no_overlapping_slots"',
      },
    });

    const mockDb = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                account_id: 'acc-1',
                meeting_duration_minutes: 15,
                timezone: 'Asia/Kolkata',
                google_calendar_enabled: false,
              },
            }),
          }),
        }),
      }),
      rpc: mockRpc,
    } as unknown as SupabaseClient;

    const result = await bookMeeting(mockDb, {
      accountId: 'acc-1',
      contactId: 'contact-1',
      title: 'OPSIYS Discovery Meeting',
      startTime: '2026-10-21T10:00:00.000Z',
      referenceDate: new Date('2026-10-21T08:00:00.000Z'),
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('SLOT_UNAVAILABLE');
    expect(result.message).toContain('just booked by another user');
  });

  it('preserves tenant isolation so concurrent bookings for separate accounts do not conflict', async () => {
    const startTime = '2026-10-21T10:00:00.000Z';
    const mockRpc = vi.fn().mockImplementation((_fnName: string, args: Record<string, unknown>) => {
      return Promise.resolve({
        data: {
          success: true,
          meeting_id: `meeting-${args.p_account_id}`,
          status: 'confirmed',
          start_time: startTime,
          end_time: '2026-10-21T10:15:00.000Z',
          timezone: 'Asia/Kolkata',
        },
        error: null,
      });
    });

    const createDbForAccount = (accId: string) =>
      ({
        from: vi.fn((table: string) => {
          if (table === 'scheduling_settings') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      account_id: accId,
                      meeting_duration_minutes: 15,
                      timezone: 'Asia/Kolkata',
                      google_calendar_enabled: false,
                    },
                  }),
                }),
              }),
            };
          }
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: true, error: null }),
            }),
          };
        }),
        rpc: mockRpc,
      } as unknown as SupabaseClient);

    const refDate = new Date('2026-10-21T08:00:00.000Z');
    const [resA, resB] = await Promise.all([
      bookMeeting(createDbForAccount('acc-A'), {
        accountId: 'acc-A',
        contactId: 'contact-A',
        title: 'Tenant A Discovery',
        startTime,
        referenceDate: refDate,
      }),
      bookMeeting(createDbForAccount('acc-B'), {
        accountId: 'acc-B',
        contactId: 'contact-B',
        title: 'Tenant B Consultation',
        startTime,
        referenceDate: refDate,
      }),
    ]);

    expect(resA.success).toBe(true);
    expect(resA.meeting_id).toBe('meeting-acc-A');
    expect(resB.success).toBe(true);
    expect(resB.meeting_id).toBe('meeting-acc-B');
    expect(mockRpc).toHaveBeenCalledWith('book_meeting_atomically', expect.objectContaining({ p_account_id: 'acc-A' }));
    expect(mockRpc).toHaveBeenCalledWith('book_meeting_atomically', expect.objectContaining({ p_account_id: 'acc-B' }));
  });

  it('does not create duplicate Google Calendar events on idempotent replay', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ calendars: { primary: { busy: [] } } }), { status: 200 }),
    );
    global.fetch = fetchSpy;

    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: true, error: null }),
    });

    const settingsRow = {
      account_id: 'acc-1',
      meeting_duration_minutes: 15,
      working_days: [1, 2, 3, 4, 5],
      working_hours_start: '09:00',
      working_hours_end: '18:00',
      timezone: 'Asia/Kolkata',
      google_calendar_enabled: true,
      google_calendar_status: 'connected',
      google_calendar_calendar_id: 'primary',
      google_calendar_tokens: encryptGoogleTokens({
        access_token: 'ya29.active',
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
          };
        }
        return { update: mockUpdate };
      }),
      rpc: vi.fn().mockResolvedValue({
        data: {
          success: true,
          meeting_id: 'existing-meeting-1',
          status: 'confirmed',
          meeting_link: 'https://meet.google.com/existing-room',
          is_idempotent_replay: true,
        },
        error: null,
      }),
    } as unknown as SupabaseClient;

    const res = await bookMeeting(mockDb, {
      accountId: 'acc-1',
      contactId: 'contact-1',
      title: 'Discovery Call',
      startTime: '2026-10-21T10:00:00.000Z',
      idempotencyKey: 'replay-key-1',
      referenceDate: new Date('2026-10-21T08:00:00.000Z'),
    });

    expect(res.success).toBe(true);
    expect(res.is_idempotent_replay).toBe(true);
    expect(res.meeting_link).toBe('https://meet.google.com/existing-room');
    // Only FreeBusy should have been called, never /events POST
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('records calendar_sync_status=failed cleanly if Google event creation fails while preserving local booking', async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    const settingsRow = {
      account_id: 'acc-1',
      meeting_duration_minutes: 15,
      working_days: [1, 2, 3, 4, 5],
      working_hours_start: '09:00',
      working_hours_end: '18:00',
      timezone: 'Asia/Kolkata',
      google_calendar_enabled: true,
      google_calendar_status: 'connected',
      google_calendar_calendar_id: 'primary',
      google_calendar_tokens: encryptGoogleTokens({
        access_token: 'ya29.active',
        expiry_date: Date.now() + 3600_000,
      }),
    };

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('freeBusy')) {
        return new Response(JSON.stringify({ calendars: { primary: { busy: [] } } }), { status: 200 });
      }
      return new Response('Google Event API 500', { status: 500 });
    });

    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'scheduling_settings') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: settingsRow, error: null }),
              }),
            }),
          };
        }
        return {
          update: vi.fn((payload: Record<string, unknown>) => {
            updateCalls.push(payload);
            return { eq: vi.fn().mockResolvedValue({ data: true, error: null }) };
          }),
        };
      }),
      rpc: vi.fn().mockResolvedValue({
        data: { success: true, meeting_id: 'meeting-local-1', status: 'confirmed' },
        error: null,
      }),
    } as unknown as SupabaseClient;

    const res = await bookMeeting(mockDb, {
      accountId: 'acc-1',
      contactId: 'contact-1',
      title: 'Discovery',
      startTime: '2026-10-21T10:00:00.000Z',
      referenceDate: new Date('2026-10-21T08:00:00.000Z'),
    });

    expect(res.success).toBe(true);
    expect(res.meeting_id).toBe('meeting-local-1');
    expect(updateCalls[0]?.calendar_sync_status).toBe('failed');
    expect(updateCalls[0]?.calendar_provider).toBe('native');
  });

  it('reschedules an existing meeting and syncs the update to Google Calendar', async () => {
    let fetchedPatchUrl = '';
    const meetingUpdates: Array<Record<string, unknown>> = [];

    const settingsRow = {
      account_id: 'acc-1',
      meeting_duration_minutes: 15,
      working_days: [1, 2, 3, 4, 5],
      working_hours_start: '09:00',
      working_hours_end: '18:00',
      timezone: 'Asia/Kolkata',
      buffer_before_minutes: 5,
      buffer_after_minutes: 10,
      google_calendar_enabled: true,
      google_calendar_status: 'connected',
      google_calendar_calendar_id: 'team@group.calendar.google.com',
      google_calendar_tokens: encryptGoogleTokens({
        access_token: 'ya29.active',
        expiry_date: Date.now() + 3600_000,
      }),
    };

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('freeBusy')) {
        return new Response(
          JSON.stringify({
            calendars: { 'team@group.calendar.google.com': { busy: [] } },
          }),
          { status: 200 },
        );
      }
      if (init?.method === 'PATCH') {
        fetchedPatchUrl = url;
        return new Response(JSON.stringify({ id: 'g-evt-1', htmlLink: 'https://cal/1' }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });

    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'meetings') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: 'meeting-123',
                      account_id: 'acc-1',
                      title: 'Discovery Call',
                      start_time: '2026-10-21T06:00:00.000Z',
                      duration_minutes: 15,
                      timezone: 'Asia/Kolkata',
                      status: 'confirmed',
                      calendar_provider: 'google_calendar',
                      calendar_event_id: 'g-evt-1',
                      calendar_sync_status: 'synced',
                      metadata: { calendar_id: 'team@group.calendar.google.com' },
                    },
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn((payload: Record<string, unknown>) => {
              meetingUpdates.push(payload);
              return {
                eq: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: {
                        id: 'meeting-123',
                        status: 'rescheduled',
                        start_time: '2026-10-22T05:30:00.000Z',
                        calendar_sync_status: payload.calendar_sync_status,
                      },
                      error: null,
                    }),
                  }),
                }),
              };
            }),
          };
        }
        if (table === 'scheduling_settings') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: settingsRow, error: null }),
              }),
            }),
          };
        }
        return {};
      }),
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    } as unknown as SupabaseClient;

    const result = await rescheduleMeeting(mockDb, {
      meetingId: 'meeting-123',
      accountId: 'acc-1',
      newStartTime: '2026-10-22T05:30:00.000Z', // 11:00 AM IST
      rescheduleReason: 'Client requested tomorrow morning',
      referenceDate: new Date('2026-10-21T08:00:00.000Z'),
    });

    expect(result.success).toBe(true);
    expect(fetchedPatchUrl).toContain(encodeURIComponent('team@group.calendar.google.com'));
    expect(fetchedPatchUrl).toContain('g-evt-1');
    expect(meetingUpdates[0]?.calendar_sync_status).toBe('synced');
    expect(meetingUpdates[0]?.status).toBe('rescheduled');
  });

  it('cancels an existing meeting, deletes Google Calendar event, and preserves local history', async () => {
    let deleteUrl = '';
    const settingsRow = {
      account_id: 'acc-1',
      google_calendar_enabled: true,
      google_calendar_status: 'connected',
      google_calendar_calendar_id: 'primary',
      google_calendar_tokens: encryptGoogleTokens({
        access_token: 'ya29.active',
        expiry_date: Date.now() + 3600_000,
      }),
    };

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        deleteUrl = url;
        return new Response('', { status: 204 });
      }
      return new Response('{}', { status: 200 });
    });

    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'meetings') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: 'meeting-123',
                      account_id: 'acc-1',
                      calendar_provider: 'google_calendar',
                      calendar_event_id: 'g-evt-to-cancel',
                      metadata: { calendar_id: 'custom-cal@group.calendar.google.com' },
                    },
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: true, error: null }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: settingsRow, error: null }),
            }),
          }),
        };
      }),
    } as unknown as SupabaseClient;

    const result = await cancelMeeting(mockDb, {
      meetingId: 'meeting-123',
      accountId: 'acc-1',
      reason: 'Client unavailable',
    });

    expect(result.success).toBe(true);
    expect(deleteUrl).toContain(encodeURIComponent('custom-cal@group.calendar.google.com'));
    expect(deleteUrl).toContain('g-evt-to-cancel');
  });
});
