import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import {
  findIntegrationBySiteKey,
  processWebsiteEvent,
  validateDomainOrigin,
} from '@/lib/website-integrations/service';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-site-key',
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin') || request.headers.get('referer');
    const siteKey =
      request.headers.get('x-site-key') ||
      new URL(request.url).searchParams.get('site_key');

    if (!siteKey) {
      return NextResponse.json(
        { error: "Missing required 'x-site-key' header or parameter" },
        { status: 401, headers: CORS_HEADERS }
      );
    }

    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const ipRate = await checkRateLimit(`sdk-ip:${clientIp}`, RATE_LIMITS.publicApi);
    if (!ipRate.success) {
      return NextResponse.json(
        { error: 'Too many requests. Please slow down.' },
        { status: 429, headers: CORS_HEADERS }
      );
    }

    const db = supabaseAdmin();
    const integration = await findIntegrationBySiteKey(db, siteKey);
    if (!integration) {
      return NextResponse.json(
        { error: 'Invalid or inactive site key' },
        { status: 401, headers: CORS_HEADERS }
      );
    }

    if (integration.domain_whitelist && integration.domain_whitelist.length > 0) {
      if (!origin) {
        return NextResponse.json(
          { error: 'Origin or Referer header required for SDK event ingestion' },
          { status: 403, headers: CORS_HEADERS }
        );
      }
      const originAllowed = validateDomainOrigin(origin, null, integration.domain_whitelist);
      if (!originAllowed) {
        return NextResponse.json(
          { error: `Origin '${origin}' is not authorized in integration domain whitelist` },
          { status: 403, headers: CORS_HEADERS }
        );
      }
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Request body must be valid JSON' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const event_type = String(body.event_type || body.event || 'lead.submitted');
    const phone = String(body.phone || body.tel || '');
    if (!phone) {
      return NextResponse.json(
        { error: "Missing required 'phone' parameter" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const result = await processWebsiteEvent(
      db,
      integration,
      {
        event_type,
        phone,
        name: typeof body.name === 'string' ? body.name : undefined,
        email: typeof body.email === 'string' ? body.email : undefined,
        idempotency_key:
          typeof body.idempotency_key === 'string'
            ? body.idempotency_key
            : undefined,
        metadata:
          typeof body.metadata === 'object' && body.metadata !== null
            ? (body.metadata as Record<string, unknown>)
            : body,
      },
      { source: 'sdk', origin }
    );

    return NextResponse.json(result, { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[/api/v1/website/sdk-events] Ingestion error:', err);
    return NextResponse.json(
      { error: message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
