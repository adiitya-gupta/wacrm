import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { normalizeSupabaseUrl } from '@/lib/supabase/normalize-url'

// Lazy, shared service-role client for automation engine work.
// Mirrors the pattern used by the webhook handler
// (src/app/api/whatsapp/webhook/route.ts).
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
    const rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
    const url = normalizeSupabaseUrl(rawUrl)
    const key = rawKey?.trim().replace(/^["']|["']$/g, '').trim()

    if (!url || !key) {
      const missing = [
        !url ? 'NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL' : null,
        !key ? 'SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SERVICE_KEY' : null,
      ]
        .filter(Boolean)
        .join(', ')
      throw new Error(`Supabase admin client misconfigured: missing ${missing}`)
    }
    _adminClient = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  }
  return _adminClient
}

/** Exposed for tests to reset cached singleton. */
export function resetSupabaseAdminClient(): void {
  _adminClient = null
}
