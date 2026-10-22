import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: vi.fn((url: string, key: string) => ({
    url,
    key,
    auth: {
      resetPasswordForEmail: vi.fn(),
    },
  })),
}))

import { createClient, resetBrowserClient } from '@/lib/supabase/client'
import { createBrowserClient } from '@supabase/ssr'

describe('createClient browser utility', () => {
  const ORIGINAL_ENV = process.env

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
    resetBrowserClient()
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
    resetBrowserClient()
  })

  it('initializes Supabase browser client with NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'

    const client = createClient()
    expect(createBrowserClient).toHaveBeenCalledTimes(1)
    expect(createBrowserClient).toHaveBeenCalledWith(
      'https://test-project.supabase.co',
      'test-anon-key'
    )
    expect(client).toBeDefined()
  })

  it('supports NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY when ANON_KEY is absent', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co'
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test_key'

    const client = createClient()
    expect(createBrowserClient).toHaveBeenCalledWith(
      'https://test-project.supabase.co',
      'sb_publishable_test_key'
    )
    expect(client).toBeDefined()
  })

  it('reuses the singleton client instance across multiple calls', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'

    const client1 = createClient()
    const client2 = createClient()

    expect(createBrowserClient).toHaveBeenCalledTimes(1)
    expect(client1).toBe(client2)
  })

  it('creates a fresh client after resetBrowserClient()', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'

    createClient()
    expect(createBrowserClient).toHaveBeenCalledTimes(1)

    resetBrowserClient()
    createClient()
    expect(createBrowserClient).toHaveBeenCalledTimes(2)
  })

  it('trims whitespace around configuration variables', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = '  https://test-project.supabase.co  '
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = '  test-anon-key  '

    createClient()
    expect(createBrowserClient).toHaveBeenCalledWith(
      'https://test-project.supabase.co',
      'test-anon-key'
    )
  })
})
