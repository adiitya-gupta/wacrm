// ============================================================
// Invitation token utilities — pure, server-side, no Supabase.
//
// Why we hash tokens at rest
// --------------------------
// The DB stores only `account_invitations.token_hash` (SHA-256
// of the random token), never the plaintext. A leaked DB snapshot
// (logs, backups, support exports) therefore can't be used to
// redeem invites — the attacker would need the original token,
// which is returned exactly once at creation time.
//
// Why 32 bytes
// ------------
// 32 bytes of CSPRNG entropy is the standard for opaque session-
// style tokens. base64url-encodes to a 43-char string, fits
// comfortably in a URL, and is well past the practical brute-
// force boundary even with SHA-256 collisions (256 bits >> any
// realistic adversary).
//
// Why base64url (not hex)
// -----------------------
// URL-safe and shorter than hex. `crypto.randomBytes(32).toString
// ('base64url')` lands at 43 characters; hex would be 64.
// ============================================================

import { createHash, randomBytes } from "node:crypto";

/** Default invite link lifetime if the caller doesn't specify. */
export const DEFAULT_INVITE_EXPIRY_DAYS = 7;

/** Hard ceiling on user-supplied `expiresInDays` (1 year). */
export const MAX_INVITE_EXPIRY_DAYS = 365;

export interface GeneratedToken {
  /** Plaintext token — return to the creator ONCE, never persist. */
  token: string;
  /** SHA-256 hex digest of the token. Persist this in the DB. */
  hash: string;
}

/**
 * Generate a fresh invite token + its hash. Call once per invite
 * creation; the plaintext is shown to the admin in the UI and
 * embedded in the shareable link, the hash is stored in
 * `account_invitations.token_hash`.
 */
export function generateInviteToken(): GeneratedToken {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

/**
 * Deterministic SHA-256 of a plaintext token. Used at redeem time
 * to look up the matching `account_invitations` row by `token_hash`.
 * Pure function — same input always produces the same output.
 */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Build the public invite URL the admin will share. The token is
 * carried in the path (not the query) so referrer-policy noise
 * and browser autocomplete don't trip up token preservation.
 *
 * `baseUrl` must NOT have a trailing slash. The function tolerates
 * one anyway (so callers can pass `NEXT_PUBLIC_SITE_URL` verbatim
 * without sweating slash hygiene).
 */
export function inviteUrl(token: string, baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/join/${token}`;
}

/**
 * Validate that a URL string is an absolute URL using HTTP or HTTPS.
 * Strips any trailing slashes. Returns null if invalid or unsupported scheme.
 */
export function validateAbsoluteHttpUrl(
  urlStr: string | undefined,
): string | null {
  if (!urlStr) return null;
  const trimmed = urlStr.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.hostname &&
      parsed.hostname.length > 0
    ) {
      return trimmed.replace(/\/+$/, "");
    }
  } catch {
    // Malformed URL string
  }
  return null;
}

/**
 * Sanitize protocol string to strictly 'http' or 'https'.
 * Defaults to 'https' if absent or unsupported.
 */
export function sanitizeProto(
  proto: string | null | undefined,
  fallback: "http" | "https" = "https",
): "http" | "https" {
  if (!proto) return fallback;
  const first = proto.split(",")[0]?.trim().toLowerCase();
  if (first === "http" || first === "https") return first;
  return fallback;
}

/**
 * Safely validate and build an origin URL from a protocol and raw host header.
 * Rejects any host string containing characters that could cause host confusion,
 * path traversal, userinfo injection, or malformed URLs.
 */
export function buildAndValidateHostUrl(
  proto: "http" | "https",
  rawHost: string,
  allowList: readonly string[] | null,
): string | null {
  const trimmed = rawHost.trim();
  // Reject characters that are never part of a legitimate host/port:
  // slashes, backslashes, userinfo (@), query (?), hash (#), whitespace, or control characters.
  if (!trimmed || /[\/\\@?#\s]/.test(trimmed)) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(`${proto}://${trimmed}`);
  } catch {
    return null;
  }

  // Ensure parsing didn't introduce userinfo, subpath, query, or hash
  if (
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    !parsed.hostname
  ) {
    return null;
  }

  // Check allowlist if configured
  if (
    !isHostAllowed(parsed.host, allowList) &&
    !isHostAllowed(parsed.hostname, allowList)
  ) {
    return null;
  }

  return parsed.origin;
}

/**
 * Compute the `expires_at` timestamp for a new invite.
 *
 * - Clamps `expiresInDays` to `[1, MAX_INVITE_EXPIRY_DAYS]`.
 * - Falls back to `DEFAULT_INVITE_EXPIRY_DAYS` for missing input.
 * - `now` is injectable so tests don't need timer mocking.
 */
export function inviteExpiresAt(
  expiresInDays: number | undefined,
  now: Date = new Date(),
): Date {
  const days = clampExpiryDays(expiresInDays);
  const ms = days * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() + ms);
}

/** Exposed for tests and for the API route that echoes the clamped value back. */
export function clampExpiryDays(expiresInDays: number | undefined): number {
  if (
    expiresInDays === undefined ||
    !Number.isFinite(expiresInDays) ||
    expiresInDays <= 0
  ) {
    return DEFAULT_INVITE_EXPIRY_DAYS;
  }
  return Math.min(Math.floor(expiresInDays), MAX_INVITE_EXPIRY_DAYS);
}

/**
 * Parse a comma-separated list of allowed hostnames from environment variable.
 * Hostnames are normalized to lowercase. Returns null if unset or empty.
 */
export function parseAllowedHosts(
  envValue: string | undefined = process.env.ALLOWED_INVITE_HOSTS,
): readonly string[] | null {
  const raw = envValue?.trim();
  if (!raw) return null;
  const list = raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

/**
 * Check whether a hostname is in the allowlist.
 * If no allowlist is configured, all hostnames are permitted (permissive mode).
 * Matches both `hostname:port` and bare `hostname` (including IPv6 [::1]:port).
 */
export function isHostAllowed(
  hostname: string,
  allowList: readonly string[] | null,
): boolean {
  if (!allowList) return true;
  const lower = hostname.toLowerCase().trim();
  if (allowList.includes(lower)) return true;
  const bareHost = lower.replace(/:\d+$/, "");
  return allowList.includes(bareHost);
}

export interface InviteBaseUrlEnv {
  NEXT_PUBLIC_SITE_URL?: string;
  ALLOWED_INVITE_HOSTS?: string;
  [key: string]: string | undefined;
}

/**
 * Resolve the base URL for publishing invite links under.
 *
 * Precedence:
 * 1. NEXT_PUBLIC_SITE_URL (explicit admin config, validated as absolute HTTP/HTTPS URL)
 * 2. X-Forwarded-Host + X-Forwarded-Proto (standard reverse-proxy headers, validated against ALLOWED_INVITE_HOSTS)
 * 3. Host header + request protocol (direct connections, validated against ALLOWED_INVITE_HOSTS)
 *
 * Returns null if no valid, authorized base URL can be determined.
 */
export function resolveInviteBaseUrl(
  request: Request,
  env: InviteBaseUrlEnv = process.env,
): string | null {
  if (env.NEXT_PUBLIC_SITE_URL) {
    const validatedExplicit = validateAbsoluteHttpUrl(env.NEXT_PUBLIC_SITE_URL);
    if (validatedExplicit) {
      return validatedExplicit;
    }
    console.warn(
      "[invitations] NEXT_PUBLIC_SITE_URL is not a valid absolute HTTP/HTTPS URL, ignoring:",
      env.NEXT_PUBLIC_SITE_URL,
    );
  }

  const allowList = parseAllowedHosts(env.ALLOWED_INVITE_HOSTS);

  // 2. X-Forwarded-Host (+ X-Forwarded-Proto)
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  if (forwardedHost) {
    const proto = sanitizeProto(
      request.headers.get("x-forwarded-proto"),
      "https",
    );
    const validated = buildAndValidateHostUrl(proto, forwardedHost, allowList);
    if (validated) return validated;
  }

  // 3. Host header + request protocol
  const host = request.headers.get("host")?.trim();
  if (host) {
    let reqProto: "http" | "https" = "https";
    try {
      reqProto = sanitizeProto(
        new URL(request.url).protocol.replace(":", ""),
        "https",
      );
    } catch {
      // Keep default https if request.url cannot be parsed
    }
    const validated = buildAndValidateHostUrl(reqProto, host, allowList);
    if (validated) return validated;
  }

  if (allowList && (forwardedHost || host)) {
    console.warn(
      "[invitations] rejected non-allow-listed or malformed host:",
      { forwardedHost, host, allowList },
    );
  } else {
    console.warn(
      "[invitations] could not derive valid base URL from request and NEXT_PUBLIC_SITE_URL is unset",
    );
  }

  return null;
}
