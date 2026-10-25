import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CANONICAL_PRODUCTION_URL,
  getAuthRedirectBaseUrl,
  normalizeBaseUrl,
} from './url';

describe('normalizeBaseUrl', () => {
  it('normalizes a valid https URL and strips trailing slashes', () => {
    expect(
      normalizeBaseUrl('https://wattomation-by-opsiys-lhmn.vercel.app///'),
    ).toBe('https://wattomation-by-opsiys-lhmn.vercel.app');
  });

  it('prepends https:// when protocol is missing on a domain', () => {
    expect(
      normalizeBaseUrl('wattomation-by-opsiys-lhmn.vercel.app'),
    ).toBe('https://wattomation-by-opsiys-lhmn.vercel.app');
  });

  it('prepends http:// for localhost or 127.0.0.1 when protocol is missing', () => {
    expect(normalizeBaseUrl('localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeBaseUrl('127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
  });

  it('preserves explicit http:// on localhost', () => {
    expect(normalizeBaseUrl('http://localhost:3000')).toBe(
      'http://localhost:3000',
    );
  });

  it('rejects unsafe schemes like javascript, ftp, data, file', () => {
    expect(normalizeBaseUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeBaseUrl('ftp://example.com')).toBeNull();
    expect(normalizeBaseUrl('data:text/html,test')).toBeNull();
    expect(normalizeBaseUrl('file:///etc/passwd')).toBeNull();
  });

  it('rejects scheme-relative and path-relative strings', () => {
    expect(normalizeBaseUrl('//evil.example')).toBeNull();
    expect(normalizeBaseUrl('/\\evil.example')).toBeNull();
    expect(normalizeBaseUrl('/auth/callback')).toBeNull();
  });

  it('rejects userinfo injection', () => {
    expect(normalizeBaseUrl('https://user:pass@evil.example')).toBeNull();
  });

  it('rejects control characters, newlines, and whitespace', () => {
    expect(normalizeBaseUrl('https://example.com\r\nSet-Cookie: x=y')).toBeNull();
    expect(normalizeBaseUrl('https://example com')).toBeNull();
  });

  it('returns null for empty or null input', () => {
    expect(normalizeBaseUrl(null)).toBeNull();
    expect(normalizeBaseUrl(undefined)).toBeNull();
    expect(normalizeBaseUrl('')).toBeNull();
    expect(normalizeBaseUrl('   ')).toBeNull();
  });
});

describe('getAuthRedirectBaseUrl', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.ALLOWED_INVITE_HOSTS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses configured NEXT_PUBLIC_SITE_URL in production environment', () => {
    const env = {
      NODE_ENV: 'production',
      NEXT_PUBLIC_SITE_URL: 'https://wattomation-by-opsiys-lhmn.vercel.app',
    };

    const baseUrl = getAuthRedirectBaseUrl({ env });
    expect(baseUrl).toBe('https://wattomation-by-opsiys-lhmn.vercel.app');
    expect(baseUrl).not.toContain('localhost');
  });

  it('normalizes NEXT_PUBLIC_SITE_URL when missing https:// in production', () => {
    const env = {
      NODE_ENV: 'production',
      NEXT_PUBLIC_SITE_URL: 'wattomation-by-opsiys-lhmn.vercel.app',
    };

    const baseUrl = getAuthRedirectBaseUrl({ env });
    expect(baseUrl).toBe('https://wattomation-by-opsiys-lhmn.vercel.app');
  });

  it('uses canonical production fallback in production when NEXT_PUBLIC_SITE_URL is unset', () => {
    const env = {
      NODE_ENV: 'production',
    };

    const baseUrl = getAuthRedirectBaseUrl({ env });
    expect(baseUrl).toBe(CANONICAL_PRODUCTION_URL);
    expect(baseUrl).not.toContain('localhost');
  });

  it('returns localhost:3000 during local development', () => {
    const env = {
      NODE_ENV: 'development',
    };

    const baseUrl = getAuthRedirectBaseUrl({ env });
    expect(baseUrl).toBe('http://localhost:3000');
  });

  it('rejects untrusted host header on server-side requests and falls back safely', () => {
    const req = new Request('http://localhost:3000/api/admin/accounts/1/reset-password', {
      headers: {
        host: 'evil-attacker.example.com',
      },
    });

    const env = {
      NODE_ENV: 'production',
      ALLOWED_INVITE_HOSTS: 'wattomation-by-opsiys-lhmn.vercel.app',
    };

    const baseUrl = getAuthRedirectBaseUrl({ request: req, env });
    expect(baseUrl).toBe(CANONICAL_PRODUCTION_URL);
    expect(baseUrl).not.toContain('evil-attacker.example.com');
  });

  it('permits allow-listed reverse proxy host header when explicitly authorized', () => {
    const req = new Request('https://portal.enterprise.com/api/admin/accounts/1/reset-password', {
      headers: {
        'x-forwarded-host': 'portal.enterprise.com',
        'x-forwarded-proto': 'https',
      },
    });

    const env = {
      NODE_ENV: 'production',
      ALLOWED_INVITE_HOSTS: 'portal.enterprise.com',
    };

    const baseUrl = getAuthRedirectBaseUrl({ request: req, env });
    expect(baseUrl).toBe('https://portal.enterprise.com');
  });
});
