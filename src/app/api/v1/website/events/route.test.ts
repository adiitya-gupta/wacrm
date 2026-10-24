import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { POST as eventsPost } from './route';
import { POST as sdkEventsPost } from '../sdk-events/route';

const mockIntegration = {
  id: 'int-123',
  account_id: 'acc-test-1',
  site_key: 'site_key_test_123',
  webhook_secret: 'webhook_secret_xyz',
  domain_whitelist: ['https://example.com', 'https://opsiys.com'],
  is_active: true,
};

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: vi.fn(() => ({
    from: vi.fn(),
  })),
}));

vi.mock('@/lib/website-integrations/service', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/website-integrations/service');
  return {
    ...actual,
    findIntegrationBySiteKey: vi.fn(async (_db, key) => {
      if (key === mockIntegration.site_key) return mockIntegration;
      return null;
    }),
    processWebsiteEvent: vi.fn(async () => ({
      success: true,
      logId: 'log-123',
      status: 'accepted',
      dispatchedActions: [],
    })),
  };
});

describe('Website Event Ingestion Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Server-to-Server Webhook: /api/v1/website/events', () => {
    it('rejects requests with 401 when x-wacrm-signature is missing', async () => {
      const payload = JSON.stringify({ phone: '+919876543210', event: 'contact.form' });
      const req = new Request('http://localhost/api/v1/website/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-site-key': mockIntegration.site_key,
        },
        body: payload,
      });

      const res = await eventsPost(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('x-wacrm-signature');
    });

    it('rejects requests with 401 when x-wacrm-signature is invalid or forged', async () => {
      const payload = JSON.stringify({ phone: '+919876543210', event: 'contact.form' });
      const req = new Request('http://localhost/api/v1/website/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-site-key': mockIntegration.site_key,
          'x-wacrm-signature': 'forged_fake_signature',
        },
        body: payload,
      });

      const res = await eventsPost(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('Invalid webhook signature');
    });

    it('accepts and processes events when x-wacrm-signature matches HMAC-SHA256', async () => {
      const payload = JSON.stringify({ phone: '+919876543210', event: 'contact.form' });
      const validSignature = createHmac('sha256', mockIntegration.webhook_secret)
        .update(payload)
        .digest('hex');

      const req = new Request('http://localhost/api/v1/website/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-site-key': mockIntegration.site_key,
          'x-wacrm-signature': validSignature,
        },
        body: payload,
      });

      const res = await eventsPost(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.logId).toBe('log-123');
    });
  });

  describe('Browser SDK Ingestion: /api/v1/website/sdk-events', () => {
    it('rejects browser SDK events with 403 when origin header is missing', async () => {
      const payload = JSON.stringify({ phone: '+919876543210' });
      const req = new Request('http://localhost/api/v1/website/sdk-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-site-key': mockIntegration.site_key,
        },
        body: payload,
      });

      const res = await sdkEventsPost(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain('Origin or Referer header required');
    });

    it('rejects browser SDK events with 403 when origin is not in domain whitelist', async () => {
      const payload = JSON.stringify({ phone: '+919876543210' });
      const req = new Request('http://localhost/api/v1/website/sdk-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-site-key': mockIntegration.site_key,
          origin: 'https://malicious-phishing.com',
        },
        body: payload,
      });

      const res = await sdkEventsPost(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain('not authorized in integration domain whitelist');
    });

    it('accepts browser SDK events with 200 when origin matches domain whitelist', async () => {
      const payload = JSON.stringify({ phone: '+919876543210' });
      const req = new Request('http://localhost/api/v1/website/sdk-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-site-key': mockIntegration.site_key,
          origin: 'https://example.com',
        },
        body: payload,
      });

      const res = await sdkEventsPost(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });
});
