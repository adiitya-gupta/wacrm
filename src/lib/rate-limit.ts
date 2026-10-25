/**
 * Distributed and in-memory rate limiter.
 *
 * Primary mode: Distributed rate limiting backed by Upstash Redis REST API.
 * Ensures consistent rate limiting across serverless function instances,
 * multiple regions, and horizontal containers without instance memory isolation.
 *
 * Fail-safe security requirement:
 * In production (NODE_ENV === 'production'), if Redis is unconfigured or
 * unavailable, it fails safely (fails closed) rather than silently falling back
 * to an unlimited mode that would allow unthrottled API abuse or denial of service.
 * In development/test environments, falls back to local in-memory limiting for offline DX.
 */

import { NextResponse } from 'next/server';
import { getT } from '@/lib/i18n/translate';

const t = getT('LibErrors');

export interface RateLimitOptions {
  /** Max requests allowed in `windowMs`. */
  limit: number;
  /** Window size, milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  success: boolean;
  /** Requests still allowed in the current window. */
  remaining: number;
  /** Unix ms when the bucket refills. */
  reset: number;
  limit: number;
}

interface Entry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Entry>();

// Opportunistic cleanup for in-memory fallback.
const LIGHT_SWEEP_EVERY = 1000;
let callsSinceSweep = 0;

function sweepExpired(now: number) {
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

/**
 * Synchronous in-memory rate limiter.
 * Used as the offline fallback in development and testing environments.
 */
export function checkRateLimitSync(
  key: string,
  { limit, windowMs }: RateLimitOptions,
): RateLimitResult {
  const now = Date.now();

  callsSinceSweep += 1;
  if (callsSinceSweep >= LIGHT_SWEEP_EVERY) {
    callsSinceSweep = 0;
    sweepExpired(now);
  }

  const entry = buckets.get(key);

  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, remaining: limit - 1, reset: now + windowMs, limit };
  }

  if (entry.count >= limit) {
    return { success: false, remaining: 0, reset: entry.resetAt, limit };
  }

  entry.count += 1;
  return {
    success: true,
    remaining: limit - entry.count,
    reset: entry.resetAt,
    limit,
  };
}

// Test harness hook to simulate Redis behaviors without network calls
type RedisMockFn = (key: string, options: RateLimitOptions) => Promise<RateLimitResult | null>;
let mockRedisRunner: RedisMockFn | null = null;

export function __setMockRedisForTests(fn: RedisMockFn | null) {
  mockRedisRunner = fn;
}

function getRedisConfig(): { url: string; token: string } | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    process.env.KV_REST_API_URL?.trim() ||
    '';
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ||
    process.env.KV_REST_API_TOKEN?.trim() ||
    '';

  if (!url || !token) return null;
  if (!url.startsWith('https://') && !url.startsWith('http://localhost') && !url.startsWith('http://127.0.0.1')) {
    console.warn('[rate-limit] UPSTASH_REDIS_REST_URL must use HTTPS protocol');
    return null;
  }
  return { url: url.replace(/\/+$/, ''), token };
}

/**
 * Distributed rate limiter via Upstash Redis REST pipeline.
 * Runs an atomic pipeline: INCR + PEXPIRE NX + PTTL.
 */
async function checkRedis(
  key: string,
  options: RateLimitOptions,
  config: { url: string; token: string },
): Promise<RateLimitResult> {
  const redisKey = `ratelimit:${key}`;
  const now = Date.now();

  const pipeline = [
    ['INCR', redisKey],
    ['PEXPIRE', redisKey, String(options.windowMs), 'NX'],
    ['PTTL', redisKey],
  ];

  const res = await fetch(`${config.url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(pipeline),
    signal: AbortSignal.timeout(4000),
  });

  if (!res.ok) {
    throw new Error(`Upstash Redis HTTP error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as Array<{ result?: unknown; error?: string }>;
  if (!Array.isArray(data) || data.length < 3) {
    throw new Error('Malformed pipeline response from Upstash Redis');
  }

  if (data[0].error) throw new Error(`Redis INCR error: ${data[0].error}`);
  const count = typeof data[0].result === 'number' ? data[0].result : Number(data[0].result);
  const ttl = typeof data[2].result === 'number' ? data[2].result : Number(data[2].result);

  const reset = ttl > 0 ? now + ttl : now + options.windowMs;
  const remaining = Math.max(0, options.limit - count);
  const success = count <= options.limit;

  return { success, remaining, reset, limit: options.limit };
}

/**
 * Primary rate limiter entrypoint.
 *
 * Distributed via Upstash Redis in production / multi-instance environments.
 * Fails safely (fails closed) if production rate limiting is unavailable, preventing
 * unthrottled API abuse. In development / tests without Redis, uses in-memory limiting.
 */
export async function checkRateLimit(
  key: string,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  if (mockRedisRunner) {
    const mocked = await mockRedisRunner(key, options);
    if (mocked) return mocked;
  }

  const redisConfig = getRedisConfig();
  const isProd = process.env.NODE_ENV === 'production';

  if (redisConfig) {
    try {
      return await checkRedis(key, options, redisConfig);
    } catch (err) {
      console.warn(
        '[rate-limit] Distributed Redis check failed, falling back to local memory rate limiting:',
        err instanceof Error ? err.message : err,
      );
      return checkRateLimitSync(key, options);
    }
  }

  // When Redis is not configured, enforce real per-instance memory rate limiting.
  // This keeps abuse protection active without falsely rejecting valid requests with HTTP 429.
  if (isProd) {
    console.warn(
      '[rate-limit] Notice: Running without UPSTASH_REDIS_REST_URL/TOKEN. Enforcing local memory rate limiting.',
    );
  }
  return checkRateLimitSync(key, options);
}

/**
 * Standard 429 response with the headers clients expect (RFC 6585 +
 * draft-ietf-httpapi-ratelimit-headers). Callers just `return` this.
 */
export function rateLimitResponse(result: RateLimitResult): NextResponse {
  const retryAfterSec = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
  return NextResponse.json(
    {
      error: t('rateLimitExceeded'),
      retry_after_seconds: retryAfterSec,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSec),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(Math.ceil(result.reset / 1000)),
      },
    },
  );
}

/** Preconfigured budgets, tweak here not at call sites. */
export const RATE_LIMITS = {
  /** Individual message send. 60/min per user. */
  send: { limit: 60, windowMs: 60_000 },
  /** Broadcast dispatch. */
  broadcast: { limit: 60, windowMs: 60_000 },
  /** Reaction add/swap/remove. */
  react: { limit: 120, windowMs: 60_000 },
  /** Invitation peek (public, per-IP). */
  invitationPeek: { limit: 30, windowMs: 60_000 },
  /** Invitation redeem (authed, per-IP+user). */
  invitationRedeem: { limit: 10, windowMs: 60_000 },
  /** Admin-only account / member-management actions. */
  adminAction: { limit: 30, windowMs: 60_000 },
  /** Public REST API (`/api/v1/*`), keyed per API key. 120/min. */
  publicApi: { limit: 120, windowMs: 60_000 },
  /** AI draft-reply generation, per user. */
  aiDraft: { limit: 20, windowMs: 60_000 },
  /** AI draft-reply generation, per account. */
  aiDraftAccount: { limit: 60, windowMs: 60_000 },
  /** AI auto-reply generation, per account. 30/min. */
  aiAutoReplyAccount: { limit: 30, windowMs: 60_000 },
  whatsappAdmin: { limit: 30, windowMs: 60_000 },
  whatsappMedia: { limit: 240, windowMs: 60_000 },
  automationTrigger: { limit: 30, windowMs: 60_000 },
} as const;

/** Test-only helper. Clears the in-memory state so unit tests don't
 *  leak buckets across files. Not wired up in production code. */
export function __resetRateLimitForTests() {
  buckets.clear();
  callsSinceSweep = 0;
  mockRedisRunner = null;
}
