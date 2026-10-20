import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  getOrCreateWebsiteIntegration,
  processWebsiteEvent,
} from '@/lib/website-integrations/service';
import { supabaseAdmin } from '@/lib/flows/admin-client';

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = await request.json().catch(() => ({}));

    const event_type = body.event_type || 'lead.submitted';
    const phone = body.phone || '+14155552671';
    const name = body.name || 'Test Website Visitor';
    const email = body.email || 'test@example.com';
    const metadata = body.metadata || { source: 'dashboard_test_tool', page: '/pricing' };

    const integration = await getOrCreateWebsiteIntegration(
      ctx.supabase,
      ctx.accountId
    );

    const db = supabaseAdmin();
    const result = await processWebsiteEvent(
      db,
      integration,
      {
        event_type,
        phone,
        name,
        email,
        metadata,
      },
      { source: 'test' }
    );

    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
