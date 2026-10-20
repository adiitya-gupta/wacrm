import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  findIntegrationBySiteKey,
  verifyWebsiteWebhookSignature,
  processWebsiteEvent,
} from '@/lib/website-integrations/service';

export async function POST(request: Request) {
  try {
    const siteKey =
      request.headers.get('x-site-key') ||
      new URL(request.url).searchParams.get('site_key');

    if (!siteKey) {
      return NextResponse.json(
        { error: "Missing required 'x-site-key' header or 'site_key' parameter" },
        { status: 401 }
      );
    }

    const db = supabaseAdmin();
    const integration = await findIntegrationBySiteKey(db, siteKey);
    if (!integration) {
      return NextResponse.json(
        { error: 'Invalid or inactive site key' },
        { status: 401 }
      );
    }

    const rawBody = await request.text();
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: 'Request body must be valid JSON' },
        { status: 400 }
      );
    }

    // If signature header is provided, verify HMAC SHA-256
    const signature = request.headers.get('x-wacrm-signature');
    if (signature) {
      const isValid = verifyWebsiteWebhookSignature(
        rawBody,
        signature,
        integration.webhook_secret
      );
      if (!isValid) {
        return NextResponse.json(
          { error: 'Invalid webhook signature' },
          { status: 401 }
        );
      }
    }

    const event_type = String(payload.event_type || payload.event || 'custom');
    const phone = String(payload.phone || payload.to || '');
    if (!phone) {
      return NextResponse.json(
        { error: "Missing required 'phone' in payload" },
        { status: 400 }
      );
    }

    const result = await processWebsiteEvent(
      db,
      integration,
      {
        event_type,
        phone,
        name: typeof payload.name === 'string' ? payload.name : undefined,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        idempotency_key:
          typeof payload.idempotency_key === 'string'
            ? payload.idempotency_key
            : undefined,
        metadata:
          typeof payload.metadata === 'object' && payload.metadata !== null
            ? (payload.metadata as Record<string, unknown>)
            : payload,
      },
      { source: 'webhook' }
    );

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error('[/api/v1/website/events] Ingestion error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error processing website event' },
      { status: 500 }
    );
  }
}
