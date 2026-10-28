import { describe, it, expect, vi, beforeEach } from 'vitest'

// In-memory store simulating Supabase database across accounts
interface DbState {
  accounts: Record<string, { id: string; name: string; metadata: Record<string, unknown> }>
  ai_configs: Record<string, Record<string, unknown>>
  profiles: Record<string, { user_id: string; account_id: string }>
}

let dbState: DbState

function resetDb() {
  dbState = {
    accounts: {
      'acc-tenant-a': {
        id: 'acc-tenant-a',
        name: 'Tenant A',
        metadata: {},
      },
      'acc-tenant-b': {
        id: 'acc-tenant-b',
        name: 'Tenant B',
        metadata: {},
      },
    },
    ai_configs: {},
    profiles: {
      'user-admin-a': { user_id: 'user-admin-a', account_id: 'acc-tenant-a' },
      'user-admin-b': { user_id: 'user-admin-b', account_id: 'acc-tenant-b' },
    },
  }
}

let currentAccountContext = {
  accountId: 'acc-tenant-a',
  userId: 'user-admin-a',
  role: 'admin',
}

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: async () => ({
    supabase: createMockSupabase(currentAccountContext.accountId),
    accountId: currentAccountContext.accountId,
    userId: currentAccountContext.userId,
    role: currentAccountContext.role,
  }),
  requireRole: async () => ({
    supabase: createMockSupabase(currentAccountContext.accountId),
    accountId: currentAccountContext.accountId,
    userId: currentAccountContext.userId,
    role: currentAccountContext.role,
  }),
  toErrorResponse: (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  },
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ success: true }),
  rateLimitResponse: () => new Response('rate limit', { status: 429 }),
  RATE_LIMITS: { adminAction: { limit: 100, windowMs: 60000 } },
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (val: string) => `enc:${val}`,
  decrypt: (val: string) => val.replace(/^enc:/, ''),
}))

vi.mock('@/lib/ai/validate', () => ({
  validateAiCredentials: async () => true,
}))

vi.mock('@/lib/ai/embeddings', () => ({
  embedTexts: async () => [[0.1, 0.2]],
}))

// Mock Supabase client query builder simulating PostgREST
function createMockSupabase(scopedAccountId: string) {
  return {
    from: (table: string) => {
      let selectedFields = '*'
      let filterAccountId: string | null = null
      let filterId: string | null = null

      interface QueryBuilder {
        select: (fields: string) => QueryBuilder
        eq: (col: string, val: string) => QueryBuilder
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>
        single: () => Promise<{ data: unknown; error: unknown }>
        update: (payload: Record<string, unknown>) => { eq: (col: string, val: string) => Promise<{ error: unknown }> }
        insert: (payload: Record<string, unknown>) => Promise<{ error: unknown }>
        delete: () => Promise<{ error: unknown }>
      }

      const builder: QueryBuilder = {
        select: (fields: string) => {
          selectedFields = fields
          return builder
        },
        eq: (col: string, val: string) => {
          if (col === 'account_id') filterAccountId = val
          if (col === 'id') filterId = val
          return builder
        },
        maybeSingle: async () => {
          if (table === 'accounts') {
            const accId = filterId || filterAccountId || scopedAccountId
            const acc = dbState.accounts[accId]
            return { data: acc ? { ...acc } : null, error: null }
          }
          if (table === 'ai_configs') {
            const accId = filterAccountId || scopedAccountId
            const cfg = dbState.ai_configs[accId]
            if (!cfg) return { data: null, error: null }
            // Simulate missing columns 42703 if selecting business_profile when not supported
            if (selectedFields.includes('business_profile') && Boolean(cfg._simulateMissingColumns)) {
              return { data: null, error: { code: '42703', message: 'column business_profile does not exist' } }
            }
            return { data: { ...cfg }, error: null }
          }
          if (table === 'profiles') {
            return { data: { user_id: 'user-admin-a' }, error: null }
          }
          return { data: null, error: null }
        },
        single: async () => {
          const res = await builder.maybeSingle()
          return res
        },
        update: (payload: Record<string, unknown>) => {
          return {
            eq: async (col: string, val: string) => {
              if (table === 'accounts') {
                const accId = val
                if (dbState.accounts[accId]) {
                  dbState.accounts[accId] = {
                    ...dbState.accounts[accId],
                    metadata: {
                      ...dbState.accounts[accId].metadata,
                      ...(payload.metadata as Record<string, unknown>),
                    },
                  }
                }
                return { error: null }
              }
              if (table === 'ai_configs') {
                const accId = val
                // If simulating missing columns and payload contains business_profile, return 42703
                if ((payload.business_profile || payload.conversation_flow) && Boolean(dbState.ai_configs[accId]?._simulateMissingColumns)) {
                  return { error: { code: '42703', message: 'column business_profile does not exist' } }
                }
                dbState.ai_configs[accId] = {
                  ...dbState.ai_configs[accId],
                  ...payload,
                }
                return { error: null }
              }
              return { error: null }
            },
          }
        },
        insert: async (payload: Record<string, unknown>) => {
          if (table === 'ai_configs') {
            const accId = (payload.account_id as string) || scopedAccountId
            dbState.ai_configs[accId] = { ...payload }
            return { error: null }
          }
          return { error: null }
        },
        delete: async () => {
          if (table === 'ai_configs') {
            const accId = filterAccountId || scopedAccountId
            delete dbState.ai_configs[accId]
            return { error: null }
          }
          return { error: null }
        },
      }
      return builder
    },
  }
}

import { GET, POST } from './route'

describe('AI Config Persistence & Reload Route', () => {
  beforeEach(() => {
    resetDb()
    currentAccountContext = {
      accountId: 'acc-tenant-a',
      userId: 'user-admin-a',
      role: 'admin',
    }
  })

  it('allows saving Business Profile without requiring an active AI API key when AI is not being enabled', async () => {
    const profilePayload = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      is_active: false,
      auto_reply_enabled: false,
      business_profile: {
        businessName: 'Stripe Consult',
        industry: 'FinTech',
        businessDescription: 'Payment optimization consultants',
        services: [{ id: 's1', name: 'Billing Audit', description: 'Audit billing flows', benefits: ['Save 10%'] }],
      },
      conversation_flow: {
        preset: 'service_to_conversion',
        conversationMode: 'ai_agent',
      },
    }

    const req = new Request('http://localhost/api/ai/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profilePayload),
    })

    const res = await POST(req)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.success).toBe(true)

    // Verify it was stored in accounts.metadata
    const account = dbState.accounts['acc-tenant-a']
    expect(account.metadata.ai_business_profile).toMatchObject({
      businessName: 'Stripe Consult',
      industry: 'FinTech',
    })
    expect(account.metadata.ai_conversation_flow).toMatchObject({
      conversationMode: 'ai_agent',
    })
  })

  it('reloads saved Business Profile and Conversation Flow on fresh GET request even when AI is unconfigured', async () => {
    // Seed account metadata directly
    dbState.accounts['acc-tenant-a'].metadata = {
      ai_business_profile: {
        businessName: 'Wattomation Solar',
        industry: 'Energy',
        businessDescription: 'Smart solar automation',
        services: [{ id: 's1', name: 'Home Battery', description: 'Lithium battery backup', benefits: ['No blackouts'] }],
      },
      ai_conversation_flow: {
        preset: 'lead_qualification',
        conversationMode: 'ai_agent',
      },
    }

    const res = await GET()
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.configured).toBe(false)
    expect(data.business_profile).toMatchObject({
      businessName: 'Wattomation Solar',
      industry: 'Energy',
    })
    expect(data.conversation_flow).toMatchObject({
      conversationMode: 'ai_agent',
    })
  })

  it('persists and reloads through schema mismatch (error 42703 on ai_configs)', async () => {
    // Simulate ai_configs existing with _simulateMissingColumns
    dbState.ai_configs['acc-tenant-a'] = {
      id: 'cfg-1',
      account_id: 'acc-tenant-a',
      provider: 'openai',
      model: 'gpt-4o-mini',
      api_key: 'enc:stored-key',
      is_active: false,
      auto_reply_enabled: false,
      _simulateMissingColumns: true,
    }

    const saveReq = new Request('http://localhost/api/ai/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        model: 'gpt-4o-mini',
        is_active: false,
        auto_reply_enabled: false,
        business_profile: {
          businessName: 'Survives 42703',
          industry: 'Software',
          services: [],
        },
      }),
    })

    const saveRes = await POST(saveReq)
    expect(saveRes.status).toBe(200)

    // Now reload via GET
    const getRes = await GET()
    const getData = await getRes.json()

    expect(getRes.status).toBe(200)
    expect(getData.configured).toBe(true)
    expect(getData.business_profile?.businessName).toBe('Survives 42703')
  })

  it('enforces strict tenant isolation: Tenant A profile is never visible or overwritten by Tenant B', async () => {
    // 1. Save profile for Tenant A
    currentAccountContext = {
      accountId: 'acc-tenant-a',
      userId: 'user-admin-a',
      role: 'admin',
    }

    await POST(
      new Request('http://localhost/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          model: 'gpt-4o-mini',
          is_active: false,
          business_profile: { businessName: 'Tenant A Company', industry: 'Logistics' },
        }),
      }),
    )

    // 2. Switch context to Tenant B
    currentAccountContext = {
      accountId: 'acc-tenant-b',
      userId: 'user-admin-b',
      role: 'admin',
    }

    // Tenant B GET should return null or Tenant B profile, NOT Tenant A
    const resB1 = await GET()
    const dataB1 = await resB1.json()
    expect(dataB1.business_profile).toBeNull()

    // 3. Save profile for Tenant B
    await POST(
      new Request('http://localhost/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          model: 'gpt-4o-mini',
          is_active: false,
          business_profile: { businessName: 'Tenant B Hospital', industry: 'Healthcare' },
        }),
      }),
    )

    // Verify Tenant B has Tenant B data
    const resB2 = await GET()
    const dataB2 = await resB2.json()
    expect(dataB2.business_profile?.businessName).toBe('Tenant B Hospital')

    // 4. Switch back to Tenant A
    currentAccountContext = {
      accountId: 'acc-tenant-a',
      userId: 'user-admin-a',
      role: 'admin',
    }
    const resA = await GET()
    const dataA = await resA.json()
    expect(dataA.business_profile?.businessName).toBe('Tenant A Company')
  })

  it('rejects invalid message templates with an actionable 400 error', async () => {
    const invalidTemplateReq = new Request('http://localhost/api/ai/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        model: 'gpt-4o-mini',
        message_templates: {
          welcome: 'Hello {{invalid_unknown_variable}}!',
        },
      }),
    })

    const res = await POST(invalidTemplateReq)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.error).toContain('Unsupported template variable')
  })

  it('saves and completely reloads all 6 AI configuration sections across sessions and reloads', async () => {
    const fullConfigPayload = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      system_prompt: 'You are Wattomation AI assistant.',
      is_active: false,
      auto_reply_enabled: false,
      auto_reply_max_per_conversation: 5,
      // 1. Business Profile (with services, custom instructions, prohibited claims)
      // 4. Pricing & Booking (pricingPackages, pricingRules)
      // 5. Tone & Language (tone, responseLength, primaryLanguage)
      business_profile: {
        businessName: 'Wattomation Enterprise',
        industry: 'SaaS & Automation',
        businessDescription: 'Intelligent WhatsApp CRM & Automation',
        services: [
          {
            id: 'srv-1',
            name: 'AI & Automation',
            description: 'Agentic workflows and automated routing',
            benefits: ['24/7 instant replies', 'Zero missed leads'],
          },
        ],
        customInstructions: 'Always be concise and cite official SLAs.',
        prohibitedClaims: ['Never promise 100% discount', 'Never guarantee zero bugs'],
        pricingPackages: [
          {
            id: 'pkg-1',
            name: 'Growth',
            price: '$199/mo',
            billingPeriod: 'monthly',
            description: 'For scaling support teams',
            features: ['10,000 messages', '3 AI agents'],
          },
        ],
        pricingRules: [
          {
            id: 'rule-1',
            title: 'Custom Scoping Rule',
            rule: 'Exact pricing is tailored on our discovery call based on volume.',
          },
        ],
        tone: 'consultative',
        responseLength: 'concise',
        primaryLanguage: 'en',
      },
      // 2. Flows & Stages
      conversation_flow: {
        preset: 'service_to_conversion',
        conversationMode: 'ai_agent',
        maxDiscoveryQuestions: 2,
        stages: [
          { id: 'greeting', name: 'Greeting', goal: 'Welcome customer' },
          { id: 'discovery', name: 'Discovery', goal: 'Collect requirements' },
          { id: 'pricing', name: 'Pricing', goal: 'Present pricing' },
        ],
        qualificationCriteria: ['Has active WhatsApp Business account', 'Budget > $1k'],
      },
      // 3. Message Templates
      message_templates: {
        welcome: 'Welcome to {{business_name}}! How can we assist you today?',
        qualificationComplete: 'Thank you for sharing your requirements. We will prepare your plan.',
        consultationInvite: 'Would you like to schedule a quick call with our specialists?',
      },
    }

    // Step 1: POST the 6 sections
    const postReq = new Request('http://localhost/api/ai/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fullConfigPayload),
    })

    const postRes = await POST(postReq)
    const postData = await postRes.json()
    expect(postRes.status).toBe(200)
    expect(postData.success).toBe(true)

    // Step 2: Fresh GET request (simulating page reload, fresh session, or new browser tab)
    const getRes = await GET()
    const getData = await getRes.json()
    expect(getRes.status).toBe(200)

    // Verify Business Profile
    expect(getData.business_profile).toMatchObject({
      businessName: 'Wattomation Enterprise',
      industry: 'SaaS & Automation',
      businessDescription: 'Intelligent WhatsApp CRM & Automation',
      customInstructions: 'Always be concise and cite official SLAs.',
      prohibitedClaims: ['Never promise 100% discount', 'Never guarantee zero bugs'],
      tone: 'consultative',
      responseLength: 'concise',
      primaryLanguage: 'en',
    })
    expect(getData.business_profile.services).toHaveLength(1)
    expect(getData.business_profile.services[0].name).toBe('AI & Automation')

    // Verify Pricing & Booking
    expect(getData.business_profile.pricingPackages).toHaveLength(1)
    expect(getData.business_profile.pricingPackages[0].name).toBe('Growth')
    expect(getData.business_profile.pricingRules).toHaveLength(1)
    expect(getData.business_profile.pricingRules[0].title).toBe('Custom Scoping Rule')

    // Verify Flows & Stages
    expect(getData.conversation_flow).toMatchObject({
      preset: 'service_to_conversion',
      conversationMode: 'ai_agent',
      maxDiscoveryQuestions: 2,
    })
    expect(getData.conversation_flow.stages).toHaveLength(3)
    expect(getData.conversation_flow.qualificationCriteria).toEqual([
      'Has active WhatsApp Business account',
      'Budget > $1k',
    ])

    // Verify Message Templates
    expect(getData.message_templates).toMatchObject({
      welcome: 'Welcome to {{business_name}}! How can we assist you today?',
      qualificationComplete: 'Thank you for sharing your requirements. We will prepare your plan.',
      consultationInvite: 'Would you like to schedule a quick call with our specialists?',
    })
  })
})

