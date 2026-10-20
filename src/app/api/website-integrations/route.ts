import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  getOrCreateWebsiteIntegration,
  generateSiteKey,
  generateWebhookSecret,
} from '@/lib/website-integrations/service';

export async function GET() {
  try {
    const ctx = await requireRole('agent');
    const integration = await getOrCreateWebsiteIntegration(
      ctx.supabase,
      ctx.accountId
    );

    return NextResponse.json({
      site_key: integration.site_key,
      webhook_secret: integration.webhook_secret,
      domain_whitelist: integration.domain_whitelist || [],
      is_active: integration.is_active,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = await request.json().catch(() => ({}));

    // Action: update_domains | regenerate_keys
    if (body.action === 'regenerate_keys') {
      const site_key = generateSiteKey();
      const webhook_secret = generateWebhookSecret();

      const { data, error } = await ctx.supabase
        .from('website_integrations')
        .update({
          site_key,
          webhook_secret,
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', ctx.accountId)
        .select('*')
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        site_key: data.site_key,
        webhook_secret: data.webhook_secret,
        domain_whitelist: data.domain_whitelist || [],
      });
    }

    if (Array.isArray(body.domain_whitelist)) {
      const cleanDomains = body.domain_whitelist
        .map((d: unknown) => String(d).trim().toLowerCase())
        .filter(Boolean);

      const { data, error } = await ctx.supabase
        .from('website_integrations')
        .update({
          domain_whitelist: cleanDomains,
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', ctx.accountId)
        .select('*')
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        site_key: data.site_key,
        webhook_secret: data.webhook_secret,
        domain_whitelist: data.domain_whitelist,
      });
    }

    return NextResponse.json({ error: 'Invalid action or payload' }, { status: 400 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
