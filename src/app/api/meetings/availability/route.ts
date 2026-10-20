import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { getAvailableSlots } from '@/lib/scheduling/availability';

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('viewer');
    const { searchParams } = new URL(request.url);

    const startDateParam = searchParams.get('startDate');
    const daysCountParam = searchParams.get('daysCount');
    const limitParam = searchParams.get('limit');

    const startDate = startDateParam ? new Date(startDateParam) : undefined;
    const daysCount = daysCountParam ? parseInt(daysCountParam, 10) : 7;
    const limit = limitParam ? parseInt(limitParam, 10) : 20;

    const slots = await getAvailableSlots(ctx.supabase, ctx.accountId, {
      startDate,
      daysCount,
      limit,
    });

    return NextResponse.json({ slots });
  } catch (err) {
    return toErrorResponse(err);
  }
}
