// ============================================================
// Helpers for auth URL resolution — password reset, confirmation,
// callback redirects.
//
// Ensures canonical production URLs in production environments,
// preserves localhost in local development, and prevents Host-header
// injection or open-redirect vulnerabilities.
// ============================================================

import {
  isHostAllowed,
  parseAllowedHosts,
  sanitizeProto,
} from './invitations';

export const CANONICAL_PRODUCTION_URL =
  'https://wattomation-by-opsiys-lhmn.vercel.app';

export interface AuthBaseUrlOptions {
  request?: Request;
  env?: Record<string, string | undefined>;
}

/**
 * Normalizes and validates a candidate base URL string.
 *
 * Handles:
 * - Missing protocol: prepends 'https://' (or 'http://' for localhost)
 * - Trailing slashes: stripped
 * - Invalid / unsafe schemes: rejected (null)
 * - Returns the canonical origin (scheme + host + optional port)
 */
export function normalizeBaseUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return null;

  // Reject scheme-relative, path-relative, userinfo or whitespace/control chars
  if (
    trimmed.startsWith('//') ||
    trimmed.startsWith('/\\') ||
    trimmed.startsWith('/') ||
    /[\s\r\n\t]/.test(trimmed)
  ) {
    return null;
  }

  let candidate = trimmed;
  // If no scheme is present, check if it's a domain or localhost
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) {
    if (
      candidate.startsWith('localhost') ||
      candidate.startsWith('127.0.0.1')
    ) {
      candidate = `http://${candidate}`;
    } else {
      candidate = `https://${candidate}`;
    }
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (!parsed.hostname || parsed.hostname.length === 0) {
      return null;
    }
    // Reject userinfo (e.g. user:pass@host)
    if (parsed.username || parsed.password) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Resolve the canonical base URL for auth flows (password reset, callback redirect).
 *
 * Precedence & Rules:
 * 1. In browser runtime:
 *    - If on localhost/127.0.0.1: return window.location.origin (preserves local dev).
 *    - In production/preview: if NEXT_PUBLIC_SITE_URL is set and valid, use it;
 *      otherwise use window.location.origin (preserves preview branches).
 * 2. In server runtime:
 *    - Check NEXT_PUBLIC_SITE_URL environment variable.
 *    - If request is passed:
 *      - If in development and host is localhost: return http://${host}.
 *      - If host is allow-listed via ALLOWED_INVITE_HOSTS: return sanitized proto + host.
 *    - Fall back to CANONICAL_PRODUCTION_URL in production, or http://localhost:3000 in dev.
 */
export function getAuthRedirectBaseUrl(options?: AuthBaseUrlOptions): string {
  const env = options?.env ?? process.env;

  // 1. Browser runtime
  if (typeof window !== 'undefined' && window.location) {
    const origin = window.location.origin;
    const hostname = window.location.hostname;

    // Localhost in browser always uses browser's local origin
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return origin;
    }

    // Explicit configured canonical URL takes precedence
    if (env.NEXT_PUBLIC_SITE_URL) {
      const normalized = normalizeBaseUrl(env.NEXT_PUBLIC_SITE_URL);
      if (normalized) return normalized;
    }

    // Fall back to window.location.origin if it's a valid HTTP/HTTPS URL
    const normalizedWindow = normalizeBaseUrl(origin);
    if (normalizedWindow) return normalizedWindow;
  }

  // 2. Server runtime: explicit canonical environment variable
  if (env.NEXT_PUBLIC_SITE_URL) {
    const normalized = normalizeBaseUrl(env.NEXT_PUBLIC_SITE_URL);
    if (normalized) return normalized;
  }

  // 3. Server runtime: request context
  if (options?.request) {
    const req = options.request;
    const forwardedHost = req.headers
      .get('x-forwarded-host')
      ?.split(',')[0]
      ?.trim();
    const host = forwardedHost || req.headers.get('host')?.trim();

    if (host) {
      const isLocal =
        host.startsWith('localhost:') ||
        host === 'localhost' ||
        host.startsWith('127.0.0.1:') ||
        host === '127.0.0.1';

      if (isLocal && (env.NODE_ENV === 'development' || !env.NODE_ENV)) {
        return `http://${host}`;
      }

      const allowList = parseAllowedHosts(env.ALLOWED_INVITE_HOSTS);
      if (isHostAllowed(host, allowList)) {
        const proto = sanitizeProto(
          req.headers.get('x-forwarded-proto'),
          'https',
        );
        return `${proto}://${host}`;
      }
    }
  }

  // 4. Default fallbacks
  if (env.NODE_ENV === 'development') {
    return 'http://localhost:3000';
  }

  return CANONICAL_PRODUCTION_URL;
}
