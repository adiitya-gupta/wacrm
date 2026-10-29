import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveEffectiveBusinessProfile } from './flow-manager'
import { loadAiConfig } from './config'
import { encrypt } from '@/lib/whatsapp/encryption'
import type { AiConfig, AiBusinessProfile } from './types'

// Mock Supabase database state for two distinct tenants
interface AccountMeta {
  ai_business_profile?: AiBusinessProfile
  [key: string]: unknown
}

interface MockDBState {
  accounts: Record<string, { id: string; metadata: AccountMeta }>
  ai_configs: Record<string, Record<string, unknown>>
}

function createMockSupabase(state: MockDBState): SupabaseClient {
  return {
    from: (table: string) => {
      let filterVal: unknown = null

      return {
        select: () => ({
          eq: (_col: string, val: unknown) => {
            filterVal = val
            return {
              maybeSingle: async () => {
                if (table === 'accounts') {
                  const acc = state.accounts[String(filterVal)]
                  return { data: acc ? { metadata: acc.metadata } : null, error: null }
                }
                if (table === 'ai_configs') {
                  const cfg = state.ai_configs[String(filterVal)]
                  return { data: cfg || null, error: null }
                }
                return { data: null, error: null }
              },
            }
          },
        }),
        update: (payload: Record<string, unknown>) => ({
          eq: async (_col: string, val: unknown) => {
            if (table === 'accounts') {
              const acc = state.accounts[String(val)]
              if (acc) {
                acc.metadata = { ...acc.metadata, ...(payload.metadata as AccountMeta) }
              }
              return { error: null }
            }
            if (table === 'ai_configs') {
              const cfg = state.ai_configs[String(val)]
              if (cfg) {
                Object.assign(cfg, payload)
              }
              return { error: null }
            }
            return { error: null }
          },
        }),
        insert: async (payload: Record<string, unknown>) => {
          if (table === 'ai_configs') {
            const accId = String(payload.account_id)
            state.ai_configs[accId] = { ...payload }
            return { error: null }
          }
          return { error: null }
        },
      }
    },
  } as unknown as SupabaseClient
}

describe('Section 1 & 2: Business Profile Multi-Tenant Persistence & Isolation', () => {
  it('executes the complete 10-step lifecycle with strict two-account isolation', async () => {
    // Shared persistent database state
    const dbState: MockDBState = {
      accounts: {
        'tenant-alpha-123': {
          id: 'tenant-alpha-123',
          metadata: {},
        },
        'tenant-beta-456': {
          id: 'tenant-beta-456',
          metadata: {},
        },
      },
      ai_configs: {
        'tenant-alpha-123': {
          account_id: 'tenant-alpha-123',
          provider: 'openai',
          model: 'gpt-4o-mini',
          api_key: encrypt('sk-test-alpha-key'),
          is_active: true,
          auto_reply_enabled: true,
          auto_reply_max_per_conversation: 3,
        },
        'tenant-beta-456': {
          account_id: 'tenant-beta-456',
          provider: 'anthropic',
          model: 'claude-3-5-sonnet',
          api_key: encrypt('sk-test-beta-key'),
          is_active: true,
          auto_reply_enabled: true,
          auto_reply_max_per_conversation: 3,
        },
      },
    }

    const db = createMockSupabase(dbState)

    // Step 1: Sign in to test account Tenant Alpha
    const tenantAlphaId = 'tenant-alpha-123'

    // Step 2: Unique test business details
    const alphaInitialProfile: AiBusinessProfile = {
      businessName: 'Apex Logistics & Freight',
      businessDescription: 'Global freight forwarding and enterprise supply chain management.',
      industry: 'Logistics & Supply Chain',
      targetCustomers: 'Manufacturers and e-commerce enterprises',
      handoffPreferences: {
        escalationContact: 'support@apexlogistics.test',
      },
      tone: 'formal',
      preferredLanguage: 'en',
      responseLength: 'detailed',
      primaryConversionGoal: 'schedule_consultation',
      faqs: [],
      pricingRules: [],
      services: [
        {
          id: 'srv-apex-1',
          name: 'Air Freight Express',
          description: 'Expedited international air cargo with customs clearance.',
          benefits: ['Next-day delivery across 40 countries', 'Real-time GPS container tracking'],
          keywords: ['air cargo', 'air freight', 'express shipping'],
        },
      ],
      pricingPackages: [
        {
          id: 'pkg-apex-1',
          name: 'Full Container Load (FCL)',
          price: '$2,400 per 40ft container',
          billingPeriod: 'per shipment',
          description: 'Dedicated container transport with port-to-port logistics.',
          features: ['Customs brokerage included', 'Temperature-controlled options'],
        },
      ],
    }

    // Step 3: Save and verify the server confirms persistence
    // Updates accounts.metadata and ai_configs
    await db.from('accounts').update({
      metadata: { ai_business_profile: alphaInitialProfile },
    }).eq('id', tenantAlphaId)

    await db.from('ai_configs').update({
      business_profile: alphaInitialProfile,
    }).eq('account_id', tenantAlphaId)

    expect(dbState.accounts[tenantAlphaId].metadata.ai_business_profile?.businessName).toBe(
      'Apex Logistics & Freight',
    )

    // Step 4: Refresh the page (fresh read from DB)
    const freshDbAfterRefresh = createMockSupabase(dbState)
    const loadedAfterRefresh = await loadAiConfig(freshDbAfterRefresh, tenantAlphaId, {
      requireDecryptedKey: false,
    })
    expect(loadedAfterRefresh?.businessProfile?.businessName).toBe('Apex Logistics & Freight')
    expect(loadedAfterRefresh?.businessProfile?.handoffPreferences?.escalationContact).toBe('support@apexlogistics.test')

    // Step 5: Navigate away and return (verify state consistency)
    const loadedAfterNavigate = await loadAiConfig(freshDbAfterRefresh, tenantAlphaId, {
      requireDecryptedKey: false,
    })
    expect(loadedAfterNavigate?.businessProfile?.services?.[0].name).toBe('Air Freight Express')

    // Step 6: Reload the page in a fresh session (clean DB client)
    const freshDbSession = createMockSupabase(dbState)
    const loadedInFreshSession = await loadAiConfig(freshDbSession, tenantAlphaId, {
      requireDecryptedKey: false,
    })

    // Step 7: Verify all expected fields remain intact
    expect(loadedInFreshSession?.businessProfile).toMatchObject({
      businessName: 'Apex Logistics & Freight',
      businessDescription: 'Global freight forwarding and enterprise supply chain management.',
      industry: 'Logistics & Supply Chain',
      targetCustomers: 'Manufacturers and e-commerce enterprises',
      handoffPreferences: {
        escalationContact: 'support@apexlogistics.test',
      },
    })

    // Step 8: Update the business description and save again
    const updatedDescription = 'Premier next-generation freight and customs automation partner.'
    const updatedAlphaProfile: AiBusinessProfile = {
      ...alphaInitialProfile,
      businessDescription: updatedDescription,
    }

    await db.from('accounts').update({
      metadata: { ai_business_profile: updatedAlphaProfile },
    }).eq('id', tenantAlphaId)

    await db.from('ai_configs').update({
      business_profile: updatedAlphaProfile,
    }).eq('account_id', tenantAlphaId)

    // Step 9: Verify new description is persisted and used by the AI Agent
    const loadedUpdated = await loadAiConfig(freshDbSession, tenantAlphaId, {
      requireDecryptedKey: false,
    })
    expect(loadedUpdated?.businessProfile?.businessDescription).toBe(updatedDescription)

    const effectiveAlpha = resolveEffectiveBusinessProfile(
      loadedUpdated as AiConfig,
      tenantAlphaId,
    )
    expect(effectiveAlpha.businessName).toBe('Apex Logistics & Freight')
    expect(effectiveAlpha.businessDescription).toBe(updatedDescription)
    expect(effectiveAlpha.services[0].name).toBe('Air Freight Express')

    // Step 10: Sign in to second test account (Tenant Beta) and confirm isolation
    const tenantBetaId = 'tenant-beta-456'
    const loadedBeta = await loadAiConfig(freshDbSession, tenantBetaId, {
      requireDecryptedKey: false,
    })

    // Tenant Beta must NOT see Tenant Alpha's profile!
    expect(loadedBeta?.businessProfile).toBeNull()

    const effectiveBeta = resolveEffectiveBusinessProfile(
      loadedBeta as AiConfig,
      tenantBetaId,
    )
    // Tenant Beta resolves clean neutral defaults, NOT Tenant Alpha's Apex Logistics
    expect(effectiveBeta.businessName).not.toBe('Apex Logistics & Freight')
    expect(effectiveBeta.businessName).toBe('Our Business')

    // Tenant Beta saves their own distinct profile
    const betaProfile: AiBusinessProfile = {
      ...alphaInitialProfile,
      businessName: 'St. Jude Dental Clinic',
      businessDescription: 'Family and cosmetic dentistry specialists.',
      industry: 'Healthcare & Dentistry',
      services: [
        {
          id: 'srv-dental-1',
          name: 'Teeth Whitening & Hygiene',
          description: 'Laser teeth whitening and comprehensive oral hygiene.',
          benefits: ['Visible results in 45 minutes'],
          keywords: ['whitening', 'cleaning', 'hygiene'],
        },
      ],
    }

    await db.from('accounts').update({
      metadata: { ai_business_profile: betaProfile },
    }).eq('id', tenantBetaId)

    await db.from('ai_configs').update({
      business_profile: betaProfile,
    }).eq('account_id', tenantBetaId)

    // Verify Tenant Beta now has their own profile
    const loadedBetaAfterSave = await loadAiConfig(freshDbSession, tenantBetaId, {
      requireDecryptedKey: false,
    })
    const effectiveBetaAfterSave = resolveEffectiveBusinessProfile(
      loadedBetaAfterSave as AiConfig,
      tenantBetaId,
    )
    expect(effectiveBetaAfterSave.businessName).toBe('St. Jude Dental Clinic')
    expect(effectiveBetaAfterSave.services[0].name).toBe('Teeth Whitening & Hygiene')

    // And verify Tenant Alpha was completely untouched!
    const reloadedAlpha = await loadAiConfig(freshDbSession, tenantAlphaId, {
      requireDecryptedKey: false,
    })
    const effectiveAlphaReloaded = resolveEffectiveBusinessProfile(
      reloadedAlpha as AiConfig,
      tenantAlphaId,
    )
    expect(effectiveAlphaReloaded.businessName).toBe('Apex Logistics & Freight')
    expect(effectiveAlphaReloaded.services[0].name).toBe('Air Freight Express')
    expect(effectiveAlphaReloaded.businessDescription).toBe(updatedDescription)
  })
})
