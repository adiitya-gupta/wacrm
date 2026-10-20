import { describe, expect, it } from "vitest";
import {
  buildAndValidateHostUrl,
  clampExpiryDays,
  DEFAULT_INVITE_EXPIRY_DAYS,
  generateInviteToken,
  hashInviteToken,
  inviteExpiresAt,
  inviteUrl,
  isHostAllowed,
  MAX_INVITE_EXPIRY_DAYS,
  parseAllowedHosts,
  resolveInviteBaseUrl,
  sanitizeProto,
  validateAbsoluteHttpUrl,
} from "./invitations";

describe("generateInviteToken", () => {
  it("returns a 43-character base64url token (32 raw bytes)", () => {
    const { token } = generateInviteToken();
    expect(token).toHaveLength(43);
    // base64url alphabet: A-Z a-z 0-9 - _ (no +, /, or =)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns a 64-char hex hash matching SHA-256 of the token", () => {
    const { token, hash } = generateInviteToken();
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(hash).toBe(hashInviteToken(token));
  });

  it("produces distinct tokens across calls", () => {
    // 32 bytes of CSPRNG entropy — a collision in 1000 draws would
    // be a thermodynamic miracle. This is a sanity guard for "did
    // someone accidentally swap randomBytes for a constant?".
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(generateInviteToken().token);
    }
    expect(seen.size).toBe(1000);
  });
});

describe("hashInviteToken", () => {
  it("is deterministic for the same input", () => {
    expect(hashInviteToken("hello")).toBe(hashInviteToken("hello"));
  });

  it("differs for different inputs", () => {
    expect(hashInviteToken("a")).not.toBe(hashInviteToken("b"));
  });

  it("matches a known SHA-256 hex digest", () => {
    // Known fixture — `sha256("invite-token-abc")` hex digest.
    // If this assertion ever flips, the hash function changed and
    // every stored token_hash in the DB is suddenly orphaned.
    expect(hashInviteToken("invite-token-abc")).toBe(
      "51481b404112f61a4e1171ff116d52068c429737863181bef089df7cb607352f",
    );
  });
});

describe("inviteUrl", () => {
  it("joins path correctly with no trailing slash", () => {
    expect(inviteUrl("abc", "https://wacrm.example")).toBe(
      "https://wacrm.example/join/abc",
    );
  });

  it("tolerates a trailing slash on baseUrl", () => {
    expect(inviteUrl("abc", "https://wacrm.example/")).toBe(
      "https://wacrm.example/join/abc",
    );
  });

  it("tolerates multiple trailing slashes", () => {
    expect(inviteUrl("abc", "https://wacrm.example///")).toBe(
      "https://wacrm.example/join/abc",
    );
  });

  it("preserves the entire token verbatim — including base64url symbols", () => {
    // The token may contain `-` and `_`. Both are URL-safe; the
    // function must NOT percent-encode them.
    expect(inviteUrl("a-b_c", "https://x")).toBe("https://x/join/a-b_c");
  });
});

describe("clampExpiryDays", () => {
  it("defaults to DEFAULT_INVITE_EXPIRY_DAYS when undefined", () => {
    expect(clampExpiryDays(undefined)).toBe(DEFAULT_INVITE_EXPIRY_DAYS);
  });

  it("defaults when given a non-finite value", () => {
    // Non-finite values (NaN, ±Infinity) are always programmer errors,
    // never legitimate input. We collapse them to the safe default
    // rather than to MAX — a buggy Infinity passing through and
    // silently producing a year-long invite would be worse than a
    // default 7-day one that the admin can re-issue.
    expect(clampExpiryDays(NaN)).toBe(DEFAULT_INVITE_EXPIRY_DAYS);
    expect(clampExpiryDays(Infinity)).toBe(DEFAULT_INVITE_EXPIRY_DAYS);
    expect(clampExpiryDays(-Infinity)).toBe(DEFAULT_INVITE_EXPIRY_DAYS);
  });

  it("rejects zero / negative", () => {
    expect(clampExpiryDays(0)).toBe(DEFAULT_INVITE_EXPIRY_DAYS);
    expect(clampExpiryDays(-5)).toBe(DEFAULT_INVITE_EXPIRY_DAYS);
  });

  it("clamps above MAX_INVITE_EXPIRY_DAYS", () => {
    expect(clampExpiryDays(99999)).toBe(MAX_INVITE_EXPIRY_DAYS);
  });

  it("passes valid values through", () => {
    expect(clampExpiryDays(1)).toBe(1);
    expect(clampExpiryDays(7)).toBe(7);
    expect(clampExpiryDays(30)).toBe(30);
  });

  it("floors fractional days", () => {
    expect(clampExpiryDays(7.9)).toBe(7);
  });
});

describe("inviteExpiresAt", () => {
  it("adds the requested days to `now`", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const out = inviteExpiresAt(7, now);
    expect(out.toISOString()).toBe("2026-01-08T00:00:00.000Z");
  });

  it("uses the default when expiresInDays is omitted", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const out = inviteExpiresAt(undefined, now);
    const expected = new Date(
      now.getTime() + DEFAULT_INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );
    expect(out.toISOString()).toBe(expected.toISOString());
  });

  it("respects the max clamp", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const out = inviteExpiresAt(99999, now);
    const expected = new Date(
      now.getTime() + MAX_INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );
    expect(out.toISOString()).toBe(expected.toISOString());
  });
});

describe("parseAllowedHosts", () => {
  it("returns null when undefined or empty string", () => {
    expect(parseAllowedHosts(undefined)).toBeNull();
    expect(parseAllowedHosts("")).toBeNull();
    expect(parseAllowedHosts("   ")).toBeNull();
  });

  it("parses and normalizes comma-separated hostnames", () => {
    const parsed = parseAllowedHosts("  CRM.Example.COM, app.company.com ,  ");
    expect(parsed).toEqual(["crm.example.com", "app.company.com"]);
  });
});

describe("isHostAllowed", () => {
  it("allows all hosts when allowList is null", () => {
    expect(isHostAllowed("anything.example.com", null)).toBe(true);
  });

  it("validates hostnames case-insensitively", () => {
    const allowList = ["crm.example.com", "app.company.com"];
    expect(isHostAllowed("CRM.Example.COM", allowList)).toBe(true);
    expect(isHostAllowed("app.company.com", allowList)).toBe(true);
    expect(isHostAllowed("evil.attacker.com", allowList)).toBe(false);
  });

  it("matches hostnames even when port is included", () => {
    const allowList = ["localhost", "crm.example.com"];
    expect(isHostAllowed("localhost:3000", allowList)).toBe(true);
    expect(isHostAllowed("crm.example.com:443", allowList)).toBe(true);
    expect(isHostAllowed("other.com:3000", allowList)).toBe(false);
  });
});

describe("resolveInviteBaseUrl", () => {
  it("prioritizes configured NEXT_PUBLIC_SITE_URL over request headers and strips trailing slashes", () => {
    const req = new Request("http://localhost:3000/api/account/invitations", {
      headers: {
        host: "localhost:3000",
        "x-forwarded-host": "forwarded.example.com",
        "x-forwarded-proto": "https",
      },
    });

    const env = {
      NEXT_PUBLIC_SITE_URL: "https://canonical.example.com///",
      ALLOWED_INVITE_HOSTS: "forbidden.com",
    };

    const baseUrl = resolveInviteBaseUrl(req, env);
    expect(baseUrl).toBe("https://canonical.example.com");
  });

  it("derives base URL from valid X-Forwarded-Host and X-Forwarded-Proto headers", () => {
    const req = new Request("http://internal-pod:8080/api/account/invitations", {
      headers: {
        "x-forwarded-host": "app.wattomation.test, proxy-edge.test",
        "x-forwarded-proto": "https",
      },
    });

    const baseUrl = resolveInviteBaseUrl(req, {});
    expect(baseUrl).toBe("https://app.wattomation.test");
  });

  it("falls back to https when X-Forwarded-Proto is missing", () => {
    const req = new Request("http://internal-pod/api/account/invitations", {
      headers: {
        "x-forwarded-host": "app.example.com",
      },
    });

    const baseUrl = resolveInviteBaseUrl(req, {});
    expect(baseUrl).toBe("https://app.example.com");
  });

  it("derives base URL from Host header and request URL protocol when no forwarded header exists", () => {
    const req = new Request("http://my-bare-server.com:3000/api/account/invitations", {
      headers: {
        host: "my-bare-server.com:3000",
      },
    });

    const baseUrl = resolveInviteBaseUrl(req, {});
    expect(baseUrl).toBe("http://my-bare-server.com:3000");
  });

  it("returns null when request host is rejected by configured ALLOWED_INVITE_HOSTS", () => {
    const req = new Request("http://internal/api/account/invitations", {
      headers: {
        host: "malicious-phishing.com",
        "x-forwarded-host": "evil.spoofed.com",
        "x-forwarded-proto": "https",
      },
    });

    const env = {
      ALLOWED_INVITE_HOSTS: "legit.example.com,app.example.com",
    };

    const baseUrl = resolveInviteBaseUrl(req, env);
    expect(baseUrl).toBeNull();
  });

  it("allows host when matching ALLOWED_INVITE_HOSTS", () => {
    const req = new Request("http://internal/api/account/invitations", {
      headers: {
        "x-forwarded-host": "legit.example.com",
        "x-forwarded-proto": "https",
      },
    });

    const env = {
      ALLOWED_INVITE_HOSTS: "legit.example.com,app.example.com",
    };

    const baseUrl = resolveInviteBaseUrl(req, env);
    expect(baseUrl).toBe("https://legit.example.com");
  });

  it("returns null when missing configuration and no valid request host information exists", () => {
    // Request without Host or X-Forwarded-Host header
    const req = new Request("http://localhost/api/account/invitations");
    req.headers.delete("host");
    req.headers.delete("x-forwarded-host");

    const baseUrl = resolveInviteBaseUrl(req, {});
    // When host is empty and NEXT_PUBLIC_SITE_URL is unset, returns null safely
    // (Never returns any unverified hardcoded domain)
    if (!req.headers.get("host")) {
      expect(baseUrl).toBeNull();
    }
  });

  it("never returns unverified fallback domain like app.wattomation.com or wacrm.tech", () => {
    const req = new Request("http://localhost/api/account/invitations", {
      headers: {
        host: "untrusted.host.net",
      },
    });

    const env = {
      ALLOWED_INVITE_HOSTS: "strictly-allowed.com",
    };

    const baseUrl = resolveInviteBaseUrl(req, env);
    expect(baseUrl).toBeNull();
  });

  it("ignores invalid NEXT_PUBLIC_SITE_URL and falls back to valid request headers", () => {
    const req = new Request("http://localhost:3000/api/account/invitations", {
      headers: {
        host: "localhost:3000",
      },
    });

    const env = {
      NEXT_PUBLIC_SITE_URL: "javascript:alert(1)",
    };

    const baseUrl = resolveInviteBaseUrl(req, env);
    expect(baseUrl).toBe("http://localhost:3000");
  });

  it("returns null when NEXT_PUBLIC_SITE_URL is invalid and request host is also rejected", () => {
    const req = new Request("http://localhost:3000/api/account/invitations", {
      headers: {
        host: "evil-spoofed.com",
      },
    });

    const env = {
      NEXT_PUBLIC_SITE_URL: "ftp://not-http.example.com",
      ALLOWED_INVITE_HOSTS: "legit.example.com",
    };

    const baseUrl = resolveInviteBaseUrl(req, env);
    expect(baseUrl).toBeNull();
  });

  it("rejects malformed host header containing path traversal, userinfo, or control characters", () => {
    const maliciousHosts = [
      "evil.com/phishing",
      "victim.com@attacker.com",
      "legit.com:80:80",
      "legit.com\\attacker.com",
      "evil.com?query=1",
      "evil.com#hash",
      "evil com",
    ];

    for (const badHost of maliciousHosts) {
      const req = new Request("http://localhost/api/account/invitations", {
        headers: { host: badHost },
      });
      const baseUrl = resolveInviteBaseUrl(req, {});
      expect(baseUrl).toBeNull();
    }
  });
});

describe("validateAbsoluteHttpUrl", () => {
  it("accepts valid http and https URLs", () => {
    expect(validateAbsoluteHttpUrl("https://example.com")).toBe(
      "https://example.com",
    );
    expect(validateAbsoluteHttpUrl("http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
    expect(validateAbsoluteHttpUrl("https://sub.domain.org/path/app")).toBe(
      "https://sub.domain.org/path/app",
    );
  });

  it("strips trailing slashes cleanly", () => {
    expect(validateAbsoluteHttpUrl("https://example.com/")).toBe(
      "https://example.com",
    );
    expect(validateAbsoluteHttpUrl("https://example.com///")).toBe(
      "https://example.com",
    );
    expect(validateAbsoluteHttpUrl("https://example.com/sub///")).toBe(
      "https://example.com/sub",
    );
  });

  it("rejects non-http/https protocols", () => {
    expect(validateAbsoluteHttpUrl("javascript:alert(1)")).toBeNull();
    expect(validateAbsoluteHttpUrl("ftp://server.example.com")).toBeNull();
    expect(validateAbsoluteHttpUrl("data:text/plain,hello")).toBeNull();
    expect(validateAbsoluteHttpUrl("ws://localhost:3000")).toBeNull();
  });

  it("rejects relative, malformed, or empty URLs", () => {
    expect(validateAbsoluteHttpUrl("example.com")).toBeNull();
    expect(validateAbsoluteHttpUrl("//example.com")).toBeNull();
    expect(validateAbsoluteHttpUrl("")).toBeNull();
    expect(validateAbsoluteHttpUrl("   ")).toBeNull();
    expect(validateAbsoluteHttpUrl(undefined)).toBeNull();
  });
});

describe("sanitizeProto", () => {
  it("preserves valid http and https", () => {
    expect(sanitizeProto("http")).toBe("http");
    expect(sanitizeProto("https")).toBe("https");
    expect(sanitizeProto("HTTPS")).toBe("https");
  });

  it("extracts first protocol from comma-separated list", () => {
    expect(sanitizeProto("https, http")).toBe("https");
    expect(sanitizeProto("http, https")).toBe("http");
  });

  it("falls back to default for missing or unsupported protocols", () => {
    expect(sanitizeProto(undefined)).toBe("https");
    expect(sanitizeProto("")).toBe("https");
    expect(sanitizeProto("ftp")).toBe("https");
    expect(sanitizeProto("javascript")).toBe("https");
    expect(sanitizeProto("invalid", "http")).toBe("http");
  });
});

describe("buildAndValidateHostUrl", () => {
  it("builds origin URL for valid host", () => {
    expect(buildAndValidateHostUrl("https", "crm.example.com", null)).toBe(
      "https://crm.example.com",
    );
    expect(buildAndValidateHostUrl("http", "localhost:3000", null)).toBe(
      "http://localhost:3000",
    );
  });

  it("rejects hosts with injected paths or userinfo", () => {
    expect(
      buildAndValidateHostUrl("https", "evil.com/join", null),
    ).toBeNull();
    expect(
      buildAndValidateHostUrl("https", "user@legit.com", null),
    ).toBeNull();
    expect(
      buildAndValidateHostUrl("https", "evil.com:badport", null),
    ).toBeNull();
  });

  it("enforces allowList when configured", () => {
    const allowList = ["crm.example.com", "localhost"];
    expect(
      buildAndValidateHostUrl("https", "crm.example.com", allowList),
    ).toBe("https://crm.example.com");
    expect(
      buildAndValidateHostUrl("http", "localhost:3000", allowList),
    ).toBe("http://localhost:3000");
    expect(
      buildAndValidateHostUrl("https", "attacker.com", allowList),
    ).toBeNull();
  });

  it("supports IPv6 bracketed hosts", () => {
    expect(buildAndValidateHostUrl("http", "[::1]:3000", null)).toBe(
      "http://[::1]:3000",
    );
    expect(
      buildAndValidateHostUrl("http", "[::1]:3000", ["[::1]"]),
    ).toBe("http://[::1]:3000");
  });
});
