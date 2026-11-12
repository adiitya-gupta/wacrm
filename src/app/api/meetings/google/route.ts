import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { disconnectGoogleCalendarForAccount } from '@/lib/scheduling/google-calendar';

export async function DELETE() {
  try {
    const ctx = await requireRole('admin');
    const admin = supabaseAdmin();

    const result = await disconnectGoogleCalendarForAccount(admin, ctx.accountId);
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to disconnect Google Calendar' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Google Calendar disconnected successfully. External conflicts will no longer be synchronized.',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

