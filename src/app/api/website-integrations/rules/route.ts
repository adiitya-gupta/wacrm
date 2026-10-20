import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function GET() {
  try {
    const ctx = await requireRole('agent');

    const { data: rules, error } = await ctx.supabase
      .from('website_integration_rules')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ rules: rules || [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = await request.json().catch(() => ({}));

    const { event_type, action_type, config, is_active } = body;

    if (!event_type || !action_type) {
      return NextResponse.json(
        { error: 'event_type and action_type are required' },
        { status: 400 }
      );
    }

    const { data: rule, error } = await ctx.supabase
      .from('website_integration_rules')
      .insert({
        account_id: ctx.accountId,
        event_type: String(event_type).trim(),
        action_type: String(action_type).trim(),
        config: typeof config === 'object' && config !== null ? config : {},
        is_active: is_active ?? true,
      })
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ rule }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
