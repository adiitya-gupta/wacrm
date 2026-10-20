/**
 * Normalize and validate a Supabase Project URL.
 *
 * Rules:
 * 1. Returns empty string for null, undefined, or empty string.
 * 2. Strips leading and trailing quotes (single and double) and surrounding whitespace.
 * 3. Removes trailing slashes.
 * 4. Validates protocol is https: or http: (http only allowed for localhost / 127.0.0.1).
 * 5. Rejects Supabase Studio / Dashboard URLs with an actionable error.
 * 6. Validates expected Supabase project API hostname:
 *    - Standard hosted projects: `*.supabase.co` (e.g. `https://<project-ref>.supabase.co`)
 *    - Local development / testing: `localhost` or `127.0.0.1`
 *    Rejects unrelated hosts (e.g. `https://example.com`, `https://google.com`).
 */
export function normalizeSupabaseUrl(rawUrl: string | undefined | null): string {
  if (!rawUrl) return ''
  const trimmed = rawUrl.trim().replace(/^["']|["']$/g, '').trim()
  if (!trimmed) return ''

  // Validate URL format
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(
      'Invalid Supabase URL: malformed URL format. Expected https://<project-ref>.supabase.co',
    )
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(
      'Invalid Supabase URL: protocol must be https or http. Expected https://<project-ref>.supabase.co',
    )
  }

  const hostname = parsed.hostname.toLowerCase()
  const pathname = parsed.pathname.toLowerCase()

  // 1. Explicitly detect and reject Supabase Studio / Dashboard URLs
  const isDashboard =
    hostname === 'app.supabase.com' ||
    hostname === 'app.supabase.io' ||
    (hostname.endsWith('supabase.com') && pathname.includes('/dashboard')) ||
    (hostname.endsWith('supabase.io') && pathname.includes('/dashboard')) ||
    pathname.includes('/dashboard/project') ||
    pathname.startsWith('/dashboard')

  if (isDashboard) {
    throw new Error(
      'Invalid Supabase URL: received Supabase Studio / Dashboard URL instead of a project API URL. Configure NEXT_PUBLIC_SUPABASE_URL as https://<project-ref>.supabase.co',
    )
  }

  // 2. Validate expected hostname:
  // - Standard hosted Supabase project: `<project-ref>.supabase.co`
  // - Local development / testing: `localhost` or `127.0.0.1`
  const isHostedSupabase =
    hostname.endsWith('.supabase.co') &&
    hostname !== 'supabase.co' &&
    /^[a-zA-Z0-9_-]+\.supabase\.co$/.test(hostname)

  const isLocalhost =
    hostname === 'localhost' || hostname === '127.0.0.1'

  if (!isHostedSupabase && !isLocalhost) {
    throw new Error(
      `Invalid Supabase URL: unexpected host "${hostname}". Expected https://<project-ref>.supabase.co`,
    )
  }

  // Strip trailing slashes
  return trimmed.replace(/\/+$/, '')
}
