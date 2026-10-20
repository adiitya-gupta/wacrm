import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client for automation engine work.
// Mirrors the pattern used by the webhook handler
// (src/app/api/whatsapp/webhook/route.ts).
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) {
      const missing = [
        !url ? 'NEXT_PUBLIC_SUPABASE_URL' : null,
        !key ? 'SUPABASE_SERVICE_ROLE_KEY' : null,
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
