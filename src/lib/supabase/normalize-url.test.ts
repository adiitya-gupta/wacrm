import { describe, expect, it } from 'vitest'
import { normalizeSupabaseUrl } from './normalize-url'

describe('normalizeSupabaseUrl', () => {
  it('returns empty string for null, undefined, or empty input', () => {
    expect(normalizeSupabaseUrl(null)).toBe('')
    expect(normalizeSupabaseUrl(undefined)).toBe('')
    expect(normalizeSupabaseUrl('')).toBe('')
    expect(normalizeSupabaseUrl('   ')).toBe('')
  })

  it('preserves valid standard Supabase project API URLs', () => {
    expect(normalizeSupabaseUrl('https://xyzcompany.supabase.co')).toBe('https://xyzcompany.supabase.co')
    expect(normalizeSupabaseUrl('https://xyzcompany.supabase.co/')).toBe('https://xyzcompany.supabase.co')
    expect(normalizeSupabaseUrl('http://127.0.0.1:54321')).toBe('http://127.0.0.1:54321')
    expect(normalizeSupabaseUrl('http://localhost:54321')).toBe('http://localhost:54321')
  })

  it('strips surrounding single and double quotes and whitespace', () => {
    expect(normalizeSupabaseUrl('"https://xyzcompany.supabase.co"')).toBe('https://xyzcompany.supabase.co')
    expect(normalizeSupabaseUrl("'https://xyzcompany.supabase.co/'")).toBe('https://xyzcompany.supabase.co')
    expect(normalizeSupabaseUrl('  "https://xyzcompany.supabase.co"  ')).toBe('https://xyzcompany.supabase.co')
  })

  it('rejects Supabase Studio / Dashboard URLs with an actionable error instead of silently rewriting', () => {
    const expectedError = /received Supabase Studio \/ Dashboard URL instead of a project API URL/

    expect(() =>
      normalizeSupabaseUrl('https://supabase.com/dashboard/project/jujyepvlmuraqutnsvcm'),
    ).toThrow(expectedError)

    expect(() =>
      normalizeSupabaseUrl('https://supabase.com/dashboard/project/jujyepvlmuraqutnsvcm/settings/api'),
    ).toThrow(expectedError)

    expect(() =>
      normalizeSupabaseUrl('https://app.supabase.com/project/my-project-ref'),
    ).toThrow(expectedError)

    expect(() =>
      normalizeSupabaseUrl('https://supabase.com/dashboard'),
    ).toThrow(expectedError)

    expect(() =>
      normalizeSupabaseUrl('"https://supabase.com/dashboard/project/jujyepvlmuraqutnsvcm"'),
    ).toThrow(expectedError)
  })

  it('rejects unrelated HTTPS hosts and bare domains', () => {
    expect(() => normalizeSupabaseUrl('https://example.com')).toThrow(/unexpected host "example.com"/)
    expect(() => normalizeSupabaseUrl('https://google.com')).toThrow(/unexpected host "google.com"/)
    expect(() => normalizeSupabaseUrl('https://attacker.org')).toThrow(/unexpected host "attacker.org"/)
    expect(() => normalizeSupabaseUrl('https://supabase.co')).toThrow(/unexpected host "supabase.co"/)
  })

  it('rejects malformed URLs and invalid protocols with an actionable error', () => {
    expect(() => normalizeSupabaseUrl('not-a-valid-url')).toThrow(/malformed URL format/)
    expect(() => normalizeSupabaseUrl('ftp://xyzcompany.supabase.co')).toThrow(/protocol must be https or http/)
  })
})
