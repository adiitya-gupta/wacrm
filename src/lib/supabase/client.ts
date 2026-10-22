import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

// Singleton instance — one client shared across the whole browser session.
// Creating multiple clients causes auth-lock contention ("Lock was released
// because another request stole it") and intermittent fetch failures.
let browserClient: SupabaseClient | undefined

export function createClient() {
  if (browserClient) return browserClient

  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const rawKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  const url = rawUrl ? rawUrl.trim() : ''
  const key = rawKey ? rawKey.trim() : ''

  browserClient = createBrowserClient(url, key)

  return browserClient
}

/** Exposed for tests to reset cached singleton. */
export function resetBrowserClient(): void {
  browserClient = undefined
}
