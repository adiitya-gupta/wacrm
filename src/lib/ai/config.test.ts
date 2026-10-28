import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// decrypt is identity in tests so we don't depend on real ciphertext.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `plain:${v}`,
}))

import { loadAiConfig, resolveConversationMode } from './config'
import type { AiConfig, AiBusinessProfile, AiConversationFlowConfig, AiMessageTemplates } from './types'

function mockSupabase(responses: {
  ai_configs?: Record<string, unknown> | null
  accounts?: Record<string, unknown> | null
}): SupabaseClient {
  return {
    from: (table: string) => {
      const row = table === 'ai_configs' ? responses.ai_configs : responses.accounts
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: row ?? null, error: null }),
      }
      return chain
    },
  } as unknown as SupabaseClient
}

const BASE_ROW = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  base_url: null,
  api_key: 'enc-key',
  system_prompt: 'You are an AI assistant',
  is_active: true,
  auto_reply_enabled: true,
  auto_reply_max_per_conversation: 5,
  embeddings_api_key: null,
  handoff_agent_id: null,
}

describe('loadAiConfig requireActive', () => {
  it('returns null for an inactive config by default', async () => {
    const db = mockSupabase({ ai_configs: { ...BASE_ROW, is_active: false } })
    expect(await loadAiConfig(db, 'acct')).toBeNull()
  })

  it('returns the config when requireActive is false (Playground path)', async () => {
    const db = mockSupabase({ ai_configs: { ...BASE_ROW, is_active: false } })
    const config = await loadAiConfig(db, 'acct', {
      requireActive: false,
    })
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('openai')
    expect(config!.baseUrl).toBeNull()
    expect(config!.apiKey).toBe('plain:enc-key')
  })

  it('returns null when there is no row', async () => {
    const db = mockSupabase({ ai_configs: null })
    expect(
      await loadAiConfig(db, 'acct', { requireActive: false }),
    ).toBeNull()
  })
})

describe('loadAiConfig accounts.metadata fallback & persistence', () => {
  it('loads business_profile, conversation_flow, and message_templates from accounts.metadata when missing in ai_configs', async () => {
    const savedProfile: AiBusinessProfile = {
      businessName: 'Acme Solar',
      businessDescription: 'Residential solar installation',
      industry: 'Solar & Renewable Energy',
      targetCustomers: 'Homeowners',
      services: [
        {
          id: 'srv-1',
          name: 'Rooftop Solar Installation',
          description: 'Tier-1 monocrystalline solar panel installation',
          benefits: ['Lower electric bills', '25-year warranty'],
        },
      ],
      pricingPackages: [
        {
          id: 'pkg-1',
          name: '5kW System',
          price: '$9,999',
          billingPeriod: 'one-time',
        },
      ],
      pricingRules: [],
      faqs: [],
      tone: 'consultative',
      preferredLanguage: 'English',
      responseLength: 'concise',
      primaryConversionGoal: 'schedule_consultation',
    }

    const savedFlow: AiConversationFlowConfig = {
      preset: 'service_to_conversion',
      conversationMode: 'ai_agent',
      maxDiscoveryQuestions: 2,
      requireDiscoveryBeforePricing: true,
      offerConsultationAfterPricing: true,
      acknowledgementStyle: 'compliment_and_benefit',
      twoOptionChoice: true,
    }

    const savedTemplates: AiMessageTemplates = {
      welcome: 'Hello from Acme Solar! How can we power your home today?',
    }

    const db = mockSupabase({
      ai_configs: { ...BASE_ROW }, // missing business_profile columns
      accounts: {
        metadata: {
          ai_business_profile: savedProfile,
          ai_conversation_flow: savedFlow,
          ai_message_templates: savedTemplates,
        },
      },
    })

    const config = await loadAiConfig(db, 'acct-123', { requireActive: true })
    expect(config).not.toBeNull()
    expect(config!.businessProfile).toEqual(savedProfile)
    expect(config!.conversationFlow).toEqual(savedFlow)
    expect(config!.messageTemplates).toEqual(savedTemplates)
    expect(config!.conversationMode).toBe('ai_agent')
  })

  it('prioritizes direct ai_configs columns if already present over metadata', async () => {
    const directProfile = { businessName: 'Direct Profile' } as AiBusinessProfile
    const metaProfile = { businessName: 'Meta Profile' } as AiBusinessProfile

    const db = mockSupabase({
      ai_configs: {
        ...BASE_ROW,
        business_profile: directProfile,
      },
      accounts: {
        metadata: {
          ai_business_profile: metaProfile,
        },
      },
    })

    const config = await loadAiConfig(db, 'acct-123', { requireActive: true })
    expect(config!.businessProfile?.businessName).toBe('Direct Profile')
  })
})

describe('resolveConversationMode', () => {
  it('resolves ai_agent when specified in conversationFlow', () => {
    expect(
      resolveConversationMode({
        conversationFlow: { conversationMode: 'ai_agent' } as unknown as AiConversationFlowConfig,
      } as unknown as AiConfig),
    ).toBe('ai_agent')
  })

  it('resolves flow_first when specified in conversationFlow', () => {
    expect(
      resolveConversationMode({
        conversationFlow: { conversationMode: 'flow_first' } as unknown as AiConversationFlowConfig,
      } as unknown as AiConfig),
    ).toBe('flow_first')
  })

  it('resolves automation_first when specified in conversationFlow', () => {
    expect(
      resolveConversationMode({
        conversationFlow: { conversationMode: 'automation_first' } as unknown as AiConversationFlowConfig,
      } as unknown as AiConfig),
    ).toBe('automation_first')
  })

  it('defaults to flow_first when config is null', () => {
    expect(resolveConversationMode(null)).toBe('flow_first')
  })

  it('defaults to ai_agent when active and auto-reply enabled with no mode set', () => {
    expect(
      resolveConversationMode({
        isActive: true,
        autoReplyEnabled: true,
      } as unknown as AiConfig),
    ).toBe('ai_agent')
  })
})
