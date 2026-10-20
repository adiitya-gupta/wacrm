import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn((url: string, key: string, options: unknown) => ({
    url,
    key,
    options,
  })),
}))

import {
  supabaseAdmin as automationsAdmin,
  resetSupabaseAdminClient as resetAutomationsAdmin,
} from '@/lib/automations/admin-client'
import {
  supabaseAdmin as flowsAdmin,
  resetSupabaseAdminClient as resetFlowsAdmin,
} from '@/lib/flows/admin-client'
import {
  supabaseAdmin as aiAdmin,
  resetSupabaseAdminClient as resetAiAdmin,
} from '@/lib/ai/admin-client'
import { createClient } from '@supabase/supabase-js'

describe('Admin Clients shared URL normalization and configuration', () => {
  const ORIGINAL_ENV = process.env

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
    resetAutomationsAdmin()
    resetFlowsAdmin()
    resetAiAdmin()
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
    resetAutomationsAdmin()
    resetFlowsAdmin()
    resetAiAdmin()
  })

  const clients = [
    { name: 'automations', getAdmin: automationsAdmin, reset: resetAutomationsAdmin },
    { name: 'flows', getAdmin: flowsAdmin, reset: resetFlowsAdmin },
    { name: 'ai', getAdmin: aiAdmin, reset: resetAiAdmin },
  ]

  for (const { name, getAdmin, reset } of clients) {
    describe(`${name} admin client`, () => {
      it('creates client with normalized API URL and strips surrounding quotes/whitespace', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = '  "https://myproject.supabase.co/"  '
        process.env.SUPABASE_SERVICE_ROLE_KEY = '  "service_role_secret_key"  '

        const client = getAdmin()
        expect(createClient).toHaveBeenCalledWith(
          'https://myproject.supabase.co',
          'service_role_secret_key',
          expect.objectContaining({
            auth: { persistSession: false, autoRefreshToken: false },
          }),
        )
        expect(client).toBeDefined()
      })

      it('rejects Supabase Studio / Dashboard URLs with actionable error', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.com/dashboard/project/myproject'
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_secret_key'

        expect(() => getAdmin()).toThrow(/received Supabase Studio \/ Dashboard URL instead of a project API URL/)
      })

      it('succeeds using fallback SUPABASE_URL and SUPABASE_SERVICE_KEY', () => {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL
        delete process.env.SUPABASE_SERVICE_ROLE_KEY
        process.env.SUPABASE_URL = 'https://fallback.supabase.co'
        process.env.SUPABASE_SERVICE_KEY = 'fallback_key'

        const client = getAdmin()
        expect(createClient).toHaveBeenCalledWith(
          'https://fallback.supabase.co',
          'fallback_key',
          expect.any(Object),
        )
        expect(client).toBeDefined()
      })

      it('throws an error when URL is missing', () => {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL
        delete process.env.SUPABASE_URL
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_secret_key'

        expect(() => getAdmin()).toThrow(/misconfigured/)
      })

      it('throws an error when service key is missing', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://myproject.supabase.co'
        delete process.env.SUPABASE_SERVICE_ROLE_KEY
        delete process.env.SUPABASE_SERVICE_KEY

        expect(() => getAdmin()).toThrow(/misconfigured/)
      })

      it('reuses singleton instance until reset', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://myproject.supabase.co'
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_secret_key'

        const client1 = getAdmin()
        const client2 = getAdmin()
        expect(createClient).toHaveBeenCalledTimes(1)
        expect(client1).toBe(client2)

        reset()
        const client3 = getAdmin()
        expect(createClient).toHaveBeenCalledTimes(2)
      })
    })
  }
})
