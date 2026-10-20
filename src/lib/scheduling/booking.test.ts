import { describe, expect, it, vi } from 'vitest';
import { bookMeeting, rescheduleMeeting, cancelMeeting } from './booking';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('Booking Engine & Concurrency Safety', () => {
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
    });

    expect(result.success).toBe(true);
    expect(result.meeting_id).toBe('mock-meeting-123');
    expect(mockRpc).toHaveBeenCalledWith(
      'book_meeting_atomically',
      expect.objectContaining({
        p_account_id: 'acc-1',
        p_contact_id: 'contact-1',
        p_title: 'OPSIYS AI Automation Discovery',
      })
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
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('SLOT_UNAVAILABLE');
    expect(result.message).toContain('just booked by another user');
  });

  it('preserves tenant isolation so concurrent bookings for separate accounts do not conflict', async () => {
    // Account A and Account B booking identical timestamp
    const startTime = '2026-10-21T10:00:00.000Z';
    const mockRpc = vi.fn().mockImplementation((fnName: string, args: Record<string, unknown>) => {
      // Both accounts succeed because exclusion constraint is scoped: account_id WITH =
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

    const [resA, resB] = await Promise.all([
      bookMeeting(createDbForAccount('acc-A'), {
        accountId: 'acc-A',
        contactId: 'contact-A',
        title: 'Tenant A Discovery',
        startTime,
      }),
      bookMeeting(createDbForAccount('acc-B'), {
        accountId: 'acc-B',
        contactId: 'contact-B',
        title: 'Tenant B Consultation',
        startTime,
      }),
    ]);

    expect(resA.success).toBe(true);
    expect(resA.meeting_id).toBe('meeting-acc-A');
    expect(resB.success).toBe(true);
    expect(resB.meeting_id).toBe('meeting-acc-B');
    expect(mockRpc).toHaveBeenCalledWith('book_meeting_atomically', expect.objectContaining({ p_account_id: 'acc-A' }));
    expect(mockRpc).toHaveBeenCalledWith('book_meeting_atomically', expect.objectContaining({ p_account_id: 'acc-B' }));
  });

  it('reschedules an existing meeting to a new time', async () => {
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
                      duration_minutes: 15,
                      timezone: 'Asia/Kolkata',
                    },
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: 'meeting-123',
                      status: 'rescheduled',
                      start_time: '2026-10-22T14:00:00.000Z',
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            }),
          }),
        };
      }),
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    } as unknown as SupabaseClient;

    const result = await rescheduleMeeting(mockDb, {
      meetingId: 'meeting-123',
      accountId: 'acc-1',
      newStartTime: '2026-10-22T14:00:00.000Z',
      rescheduleReason: 'Client requested tomorrow afternoon',
    });

    expect(result.success).toBe(true);
  });

  it('cancels an existing meeting and records cancellation reason', async () => {
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
                      calendar_event_id: null,
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
              maybeSingle: vi.fn().mockResolvedValue({ data: null }),
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
  });
});
