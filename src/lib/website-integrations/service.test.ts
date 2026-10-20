import { describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import {
  generateSiteKey,
  generateWebhookSecret,
  verifyWebsiteWebhookSignature,
  validateDomainOrigin,
  interpolateTemplate,
  processWebsiteEvent,
} from './service';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('Website Integrations Service', () => {
  it('generates secure site keys and secrets with expected prefixes', () => {
    const siteKey = generateSiteKey();
    const secret = generateWebhookSecret();

    expect(siteKey).toMatch(/^wk_live_[a-f0-9]{32}$/);
    expect(secret).toMatch(/^whsec_[a-f0-9]{48}$/);
  });

  it('validates HMAC SHA-256 webhook signatures with timestamp scheme', () => {
    const secret = 'whsec_test_secret_key_12345';
    const rawBody = JSON.stringify({ event: 'lead.submitted', phone: '+14155552671' });
    const timestamp = Math.floor(Date.now() / 1000);

    const hash = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');

    const validHeader = `t=${timestamp},v1=${hash}`;
    expect(verifyWebsiteWebhookSignature(rawBody, validHeader, secret)).toBe(true);

    // Tampered body
    expect(verifyWebsiteWebhookSignature('tampered_body', validHeader, secret)).toBe(false);

    // Expired timestamp (older than 10 minutes)
    const expiredTimestamp = timestamp - 700;
    const expiredHash = crypto
      .createHmac('sha256', secret)
      .update(`${expiredTimestamp}.${rawBody}`)
      .digest('hex');
    expect(
      verifyWebsiteWebhookSignature(rawBody, `t=${expiredTimestamp},v1=${expiredHash}`, secret)
    ).toBe(false);
  });

  it('validates allowed browser origins against domain whitelist', () => {
    const whitelist = ['example.com', 'app.mycompany.io'];

    expect(validateDomainOrigin('https://example.com', null, whitelist)).toBe(true);
    expect(validateDomainOrigin('https://sub.example.com', null, whitelist)).toBe(true);
    expect(validateDomainOrigin('https://app.mycompany.io', null, whitelist)).toBe(true);
    expect(validateDomainOrigin('https://malicious-site.com', null, whitelist)).toBe(false);

    // Empty whitelist permits all (development mode)
    expect(validateDomainOrigin('https://random.com', null, [])).toBe(true);
  });

  it('interpolates template placeholders from event payload data', () => {
    const template = 'Hello {{name}}! We received your {{event_type}} request for {{metadata.product}}.';
    const data = {
      name: 'Alice',
      event_type: 'quote',
      metadata: { product: 'WACRM Pro' },
    };

    const result = interpolateTemplate(template, data);
    expect(result).toBe('Hello Alice! We received your quote request for WACRM Pro.');
  });

  it('detects duplicate events using idempotency_key', async () => {
    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'website_event_logs') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: 'log-existing-123',
                      status: 'processed',
                      dispatched_actions: [{ action_type: 'send_whatsapp_message', success: true }],
                    },
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    const integration = {
      id: 'int-1',
      account_id: 'acc-1',
      site_key: 'wk_live_123',
      webhook_secret: 'whsec_123',
      domain_whitelist: [],
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const res = await processWebsiteEvent(
      mockDb,
      integration,
      {
        event_type: 'lead.submitted',
        phone: '+14155552671',
        idempotency_key: 'unique_order_999',
      },
      { source: 'webhook' }
    );

    expect(res.success).toBe(true);
    expect(res.logId).toBe('log-existing-123');
    expect(res.status).toBe('processed');
  });
});
