import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function GET() {
  try {
    const ctx = await requireRole('agent');

    const { data: invoices, error } = await ctx.supabase
      .from('billing_invoices')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ invoices: invoices || [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}
