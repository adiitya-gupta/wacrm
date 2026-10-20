import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client for the Flows engine.
// Mirrors src/lib/automations/admin-client.ts — same shape so anyone
// reading either file picks up the convention immediately.
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
    const rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
    const url = rawUrl?.trim().replace(/^["']|["']$/g, '')
    const key = rawKey?.trim().replace(/^["']|["']$/g, '')

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
