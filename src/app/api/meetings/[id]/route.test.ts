import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  cancelMeeting: vi.fn(),
  rescheduleMeeting: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((err) =>
    NextResponse.json(
      { error: err instanceof Error ? err.message : 'auth error' },
      { status: (err as { status?: number })?.status || 500 },
    ),
  ),
}));

vi.mock('@/lib/scheduling/booking', () => ({
  cancelMeeting: mocks.cancelMeeting,
  rescheduleMeeting: mocks.rescheduleMeeting,
}));

import { PATCH, DELETE } from './route';

describe('/api/meetings/[id] route handlers', () => {
  const mockSupabase = {} as unknown;

  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.requireRole.mockResolvedValue({
      supabase: mockSupabase,
      accountId: 'acc-1',
      userId: 'user-1',
      role: 'agent',
    });
  });

  it('DELETE reads cancellation reason from JSON body when query param is absent', async () => {
    mocks.cancelMeeting.mockResolvedValue({ success: true });

    const req = new Request('https://app.wattomation.com/api/meetings/m-1', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Customer rescheduled externally' }),
    });

    const res = await DELETE(req, { params: Promise.resolve({ id: 'm-1' }) });
    expect(res.status).toBe(200);
    expect(mocks.cancelMeeting).toHaveBeenCalledWith(mockSupabase, {
      meetingId: 'm-1',
      accountId: 'acc-1',
      reason: 'Customer rescheduled externally',
    });
  });

  it('DELETE prefers query param reason when present and handles missing body', async () => {
    mocks.cancelMeeting.mockResolvedValue({ success: true });

    const req = new Request('https://app.wattomation.com/api/meetings/m-2?reason=Conflict%20found', {
      method: 'DELETE',
    });

    const res = await DELETE(req, { params: Promise.resolve({ id: 'm-2' }) });
    expect(res.status).toBe(200);
    expect(mocks.cancelMeeting).toHaveBeenCalledWith(mockSupabase, {
      meetingId: 'm-2',
      accountId: 'acc-1',
      reason: 'Conflict found',
    });
  });

  it('PATCH reschedules with computed endTime when durationMinutes is supplied', async () => {
    mocks.rescheduleMeeting.mockResolvedValue({
      success: true,
      meeting: { id: 'm-3', status: 'rescheduled' },
    });

    const req = new Request('https://app.wattomation.com/api/meetings/m-3', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startTime: '2026-11-20T06:00:00.000Z',
        durationMinutes: 30,
        rescheduleReason: 'Moved by agent',
      }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'm-3' }) });
    expect(res.status).toBe(200);
    expect(mocks.rescheduleMeeting).toHaveBeenCalledWith(mockSupabase, {
      meetingId: 'm-3',
      accountId: 'acc-1',
      newStartTime: '2026-11-20T06:00:00.000Z',
      newEndTime: '2026-11-20T06:30:00.000Z',
      timezone: undefined,
      rescheduleReason: 'Moved by agent',
    });
  });
});

