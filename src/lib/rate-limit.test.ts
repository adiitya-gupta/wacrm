import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetRateLimitForTests,
  __setMockRedisForTests,
  checkRateLimit,
  rateLimitResponse,
} from "./rate-limit";

const OPTS = { limit: 3, windowMs: 60_000 };

describe("checkRateLimit — in-memory / local fallback", () => {
  beforeEach(() => {
    __resetRateLimitForTests();
  });

  it("permits the first request and decrements remaining", async () => {
    const result = await checkRateLimit("user:1", OPTS);
    expect(result).toMatchObject({
      success: true,
      remaining: 2,
      limit: 3,
    });
    expect(result.reset).toBeGreaterThan(Date.now());
  });

  it("permits exactly `limit` requests then rejects the next", async () => {
    expect((await checkRateLimit("user:1", OPTS)).success).toBe(true);
    expect((await checkRateLimit("user:1", OPTS)).success).toBe(true);
    expect((await checkRateLimit("user:1", OPTS)).success).toBe(true);
    const over = await checkRateLimit("user:1", OPTS);
    expect(over.success).toBe(false);
    expect(over.remaining).toBe(0);
  });

  it("keeps separate counters per key", async () => {
    await checkRateLimit("user:1", OPTS);
    await checkRateLimit("user:1", OPTS);
    await checkRateLimit("user:1", OPTS);
    // user:1 is at the cap, user:2 should still be unaffected.
    const other = await checkRateLimit("user:2", OPTS);
    expect(other.success).toBe(true);
    expect(other.remaining).toBe(2);
  });

  it("opens a fresh window after `windowMs` elapses", async () => {
    vi.useFakeTimers();
    try {
      const t0 = new Date("2026-05-01T00:00:00Z").getTime();
      vi.setSystemTime(t0);
      __resetRateLimitForTests();

      await checkRateLimit("user:1", OPTS);
      await checkRateLimit("user:1", OPTS);
      await checkRateLimit("user:1", OPTS);
      expect((await checkRateLimit("user:1", OPTS)).success).toBe(false);

      // Jump just past the window.
      vi.setSystemTime(t0 + OPTS.windowMs + 1);
      const refreshed = await checkRateLimit("user:1", OPTS);
      expect(refreshed.success).toBe(true);
      expect(refreshed.remaining).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("checkRateLimit — distributed Upstash Redis & fail-safe security", () => {
  beforeEach(() => {
    __resetRateLimitForTests();
  });

  it("uses Redis mock correctly for distributed execution", async () => {
    __setMockRedisForTests(async (key, options) => {
      return {
        success: true,
        remaining: options.limit - 1,
        reset: Date.now() + options.windowMs,
        limit: options.limit,
      };
    });

    const res = await checkRateLimit("distributed-key", OPTS);
    expect(res.success).toBe(true);
    expect(res.remaining).toBe(2);
    expect(res.limit).toBe(3);
  });

  it("fails safely (closed) in production when Redis is unconfigured or fails (never unlimited)", async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      // Simulate production runtime
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      delete process.env.KV_REST_API_URL;
      delete process.env.KV_REST_API_TOKEN;

      const res = await checkRateLimit("api-key:prod-caller", OPTS);

      // Must fail closed: success false, remaining 0
      expect(res.success).toBe(false);
      expect(res.remaining).toBe(0);
      expect(res.limit).toBe(3);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
    }
  });

  it("fails safely in production when Redis network error occurs", async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalFetch = global.fetch;
    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      process.env.UPSTASH_REDIS_REST_URL = "https://fake-redis.upstash.io";
      process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";

      // Mock fetch to simulate Redis timeout/network error
      global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

      const res = await checkRateLimit("api-key:network-down", OPTS);

      // Fail-safe: must not allow unlimited mode
      expect(res.success).toBe(false);
      expect(res.remaining).toBe(0);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
      global.fetch = originalFetch;
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
    }
  });

  it("correctly parses Upstash Redis pipeline response", async () => {
    const originalFetch = global.fetch;
    try {
      process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
      process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { result: 2 }, // INCR -> 2 requests
          { result: 1 }, // PEXPIRE NX
          { result: 45000 }, // PTTL -> 45s remaining
        ],
      });

      const res = await checkRateLimit("test-key", OPTS);
      expect(res.success).toBe(true);
      expect(res.remaining).toBe(1); // 3 - 2 = 1 remaining
      expect(res.limit).toBe(3);
    } finally {
      global.fetch = originalFetch;
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
    }
  });
});

describe("rateLimitResponse", () => {
  it("returns a 429 with retry / X-RateLimit headers", async () => {
    const reset = Date.now() + 30_000;
    const res = rateLimitResponse({
      success: false,
      remaining: 0,
      reset,
      limit: 60,
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("60");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/rate limit/i);
  });

  it("clamps Retry-After to a minimum of 1 second", () => {
    // Reset already in the past — the ceiling math would otherwise give 0.
    const res = rateLimitResponse({
      success: false,
      remaining: 0,
      reset: Date.now() - 5_000,
      limit: 10,
    });
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  });
});

describe("RATE_LIMITS presets", () => {
  it("send and broadcast are budgeted per minute", async () => {
    __resetRateLimitForTests();
    const { RATE_LIMITS } = await import("./rate-limit");
    expect(RATE_LIMITS.send.windowMs).toBe(60_000);
    expect(RATE_LIMITS.broadcast.windowMs).toBe(60_000);
  });

  it("the broadcast budget carries a campaign's per-batch call pattern", async () => {
    __resetRateLimitForTests();
    const { RATE_LIMITS } = await import("./rate-limit");
    expect(RATE_LIMITS.broadcast.limit).toBeGreaterThanOrEqual(45);
  });
});

afterEach(() => {
  __resetRateLimitForTests();
});
