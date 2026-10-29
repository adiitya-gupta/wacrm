import { describe, it, expect, vi } from 'vitest'
import {
  processConversationFlow,
  resolveEffectiveBusinessProfile,
  matchServiceFromCatalog,
} from './flow-manager'
import type { AiConfig, ChatMessage, ServiceItem } from './types'
import { DEFAULT_AI_BUSINESS_PROFILE } from './defaults'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/scheduling/availability', () => ({
  getAvailableSlots: vi.fn().mockResolvedValue([
    {
      startTime: '2026-10-28T10:00:00.000Z',
      endTime: '2026-10-28T10:15:00.000Z',
      formattedDate: 'Wed, Oct 28',
      formattedTime: '3:30 PM',
      timezone: 'Asia/Kolkata',
    },
  ]),
  isSlotAvailable: vi.fn().mockResolvedValue(true),
  formatSlotsForWhatsApp: vi.fn().mockReturnValue('1. Wed, Oct 28 at 3:30 PM (IST)'),
  loadSchedulingSettings: vi.fn().mockResolvedValue({
    meeting_duration_minutes: 15,
    timezone: 'Asia/Kolkata',
    default_meeting_link: 'https://meet.google.com/test-link',
  }),
}))

vi.mock('@/lib/scheduling/booking', () => ({
  bookMeeting: vi.fn().mockResolvedValue({
    success: true,
    meeting_id: 'meeting-uuid-123',
    meeting_link: 'https://meet.google.com/confirmed-link',
  }),
  cancelMeeting: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('./generate', () => ({
  generateReply: vi.fn().mockResolvedValue({
    text: "Welcome! Before we dive in, what kind of business do you run?",
    handoff: false,
    usage: null,
  }),
}))

function createMockSupabase(initialState: Record<string, unknown> | null = null) {
  let storedRow: Record<string, unknown> | null = initialState
  return {
    from: vi.fn().mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockImplementation(() =>
            Promise.resolve({ data: storedRow, error: null }),
          ),
          single: vi.fn().mockImplementation(() =>
            Promise.resolve({ data: storedRow, error: null }),
          ),
        }),
      }),
      insert: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
        storedRow = { id: 'qual-123', ...payload }
        return {
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: storedRow, error: null }),
          }),
        }
      }),
      update: vi.fn().mockImplementation((updates: Record<string, unknown>) => {
        storedRow = { ...storedRow, ...updates }
        return {
          eq: vi.fn().mockResolvedValue({ error: null }),
        }
      }),
    })),
    __getStored: () => storedRow,
  } as unknown as SupabaseClient
}

describe('Deterministic Conversation Flow Manager', () => {
  const baseConfig: AiConfig = {
    provider: 'openai',
    model: 'gpt-4o',
    baseUrl: null,
    apiKey: 'sk-test',
    systemPrompt: 'You are an advisor.',
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 10,
    handoffAgentId: null,
    embeddingsApiKey: null,
  }

  it('resolves OPSIYS default business profile when account matches OPSIYS_ACCOUNT_ID', () => {
    process.env.OPSIYS_ACCOUNT_ID = 'acct-opsiys-1'
    const profile = resolveEffectiveBusinessProfile(baseConfig, 'acct-opsiys-1')
    expect(profile.businessName).toBe('OPSIYS')
    expect(profile.services.length).toBeGreaterThan(3)
  })

  it('resolves custom tenant profile when configured', () => {
    const customConfig: AiConfig = {
      ...baseConfig,
      businessProfile: {
        ...DEFAULT_AI_BUSINESS_PROFILE,
        businessName: 'Dental Care Clinic',
        industry: 'Healthcare',
      },
    }
    const profile = resolveEffectiveBusinessProfile(customConfig, 'acct-dental-99')
    expect(profile.businessName).toBe('Dental Care Clinic')
    expect(profile.industry).toBe('Healthcare')
  })

  it('matches service from catalog accurately', () => {
    const services: ServiceItem[] = [
      {
        id: 's1',
        name: 'Email & Marketing Automation',
        description: 'Drips and workflows',
        benefits: ['save time'],
        keywords: ['email', 'email automation'],
      },
      {
        id: 's2',
        name: 'WhatsApp AI Chatbot',
        description: 'Chatbot 24/7',
        benefits: ['instant response'],
        keywords: ['whatsapp', 'bot'],
      },
    ]

    expect(matchServiceFromCatalog('I need email automation for my store', services)?.id).toBe('s1')
    expect(matchServiceFromCatalog('Tell me about your whatsapp bots', services)?.id).toBe('s2')
    expect(matchServiceFromCatalog('Just saying hello', services)).toBeNull()

    // Verify multi-word and tokenized matching against real button titles
    const multiServices = [
      {
        id: 'srv-ai',
        name: 'AI & Business Automation',
        description: 'AI agents, WhatsApp automation, and business process automation',
        benefits: ['save time'],
        keywords: ['ai', 'automation', 'bot', 'agent'],
      },
      {
        id: 'srv-web',
        name: 'Website & Web Application Development',
        description: 'Business websites and web apps',
        benefits: ['modern presence'],
        keywords: [],
      },
      {
        id: 'srv-seo',
        name: 'SEO & Digital Marketing',
        description: 'Technical SEO and marketing',
        benefits: ['grow traffic'],
        keywords: [],
      },
    ]

    expect(matchServiceFromCatalog('AI & Automation', multiServices)?.id).toBe('srv-ai')
    expect(matchServiceFromCatalog('Marketing & SEO', multiServices)?.id).toBe('srv-seo')
    expect(matchServiceFromCatalog('Web & Development', multiServices)?.id).toBe('srv-web')
  })

  it('Stage B: Immediately acknowledges selected service with benefit and exactly 2 options', async () => {
    process.env.OPSIYS_ACCOUNT_ID = 'acct-opsiys-1'
    const db = createMockSupabase()

    const messages: ChatMessage[] = [
      { role: 'user', content: 'We need email automation for our business' },
    ]

    const result = await processConversationFlow({
      db,
      accountId: 'acct-opsiys-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      messages,
      config: baseConfig,
      contactName: 'Alex',
    })

    expect(result.handoff).toBe(false)
    expect(result.state.currentStage).toBe('STAGE_B_ACKNOWLEDGE_SERVICE')
    expect(result.state.selectedServiceName).toBe('Email & Marketing Automation')
    expect(result.state.benefitsExplained).toBe(true)

    // Must offer the two clear options
    expect(result.text).toContain('Great choice!')
    expect(result.text).toContain('Email & Marketing Automation')
    expect(result.text).toContain('1. Explore pricing')
    expect(result.text).toContain('2. Book a consultation')
  })

  it('Stage C: Directly handles pricing inquiry when customer asks for pricing or chooses option 1', async () => {
    process.env.OPSIYS_ACCOUNT_ID = 'acct-opsiys-1'

    // Customer already has email automation selected, then asks "What is your pricing?"
    const existingState = {
      state: 'REQUIREMENT_DISCOVERY',
      flow_state: {
        currentFlow: 'service_to_conversion',
        currentStage: 'STAGE_B_ACKNOWLEDGE_SERVICE',
        servicesIdentified: ['Email & Marketing Automation'],
        selectedService: 'email-automation',
        selectedServiceName: 'Email & Marketing Automation',
        informationCollected: {},
        lastQuestionAsked: null,
        optionsOffered: ['1. Explore pricing', '2. Book a consultation'],
        selectedOption: null,
        discoveryQuestionsAsked: 0,
        pricingRequested: false,
        consultationRequested: false,
        benefitsExplained: true,
        pricingDiscussed: false,
        pendingBooking: {},
        status: 'in_progress',
      },
    }
    const dbWithState = createMockSupabase(existingState)

    const messages: ChatMessage[] = [
      { role: 'user', content: 'We need email automation' },
      { role: 'assistant', content: '1. Explore pricing\n2. Book a consultation' },
      { role: 'user', content: '1' }, // user selects Option 1
    ]

    const result = await processConversationFlow({
      db: dbWithState,
      accountId: 'acct-opsiys-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      messages,
      config: baseConfig,
    })

    expect(result.state.currentStage).toBe('STAGE_C_PRICING')
    expect(result.state.pricingDiscussed).toBe(true)
    expect(result.text).toContain('Starter Automation')
    expect(result.text).toContain('$499')
    expect(result.text).toContain('consultation')
  })

  it('Stage D: Directly initiates consultation path when customer selects option 2 or asks to book a call', async () => {
    process.env.OPSIYS_ACCOUNT_ID = 'acct-opsiys-1'
    const existingState = {
      state: 'REQUIREMENT_DISCOVERY',
      flow_state: {
        currentFlow: 'service_to_conversion',
        currentStage: 'STAGE_B_ACKNOWLEDGE_SERVICE',
        servicesIdentified: ['Email & Marketing Automation'],
        selectedService: 'email-automation',
        selectedServiceName: 'Email & Marketing Automation',
        informationCollected: {},
        lastQuestionAsked: null,
        optionsOffered: ['1. Explore pricing', '2. Book a consultation'],
        selectedOption: null,
        discoveryQuestionsAsked: 0,
        pricingRequested: false,
        consultationRequested: false,
        benefitsExplained: true,
        pricingDiscussed: false,
        pendingBooking: {},
        status: 'in_progress',
      },
    }
    const db = createMockSupabase(existingState)

    const messages: ChatMessage[] = [
      { role: 'user', content: 'We need email automation' },
      { role: 'assistant', content: '1. Explore pricing\n2. Book a consultation' },
      { role: 'user', content: '2. Book a consultation' },
    ]

    const result = await processConversationFlow({
      db,
      accountId: 'acct-opsiys-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      messages,
      config: baseConfig,
    })

    expect(result.state.currentStage).toBe('SLOT_SELECTION')
    expect(result.state.consultationRequested).toBe(true)
    expect(result.text).toContain('Wed, Oct 28 at 3:30 PM')
  })

  it('Confirms meeting only after successful booking operation', async () => {
    process.env.OPSIYS_ACCOUNT_ID = 'acct-opsiys-1'
    const schedulingState = {
      state: 'SLOT_SELECTION',
      proposed_slots: [
        {
          startTime: '2026-10-28T10:00:00.000Z',
          endTime: '2026-10-28T10:15:00.000Z',
          formattedDate: 'Wed, Oct 28',
          formattedTime: '3:30 PM',
          timezone: 'Asia/Kolkata',
        },
      ],
      flow_state: {
        currentFlow: 'service_to_conversion',
        currentStage: 'SLOT_SELECTION',
        servicesIdentified: ['Email & Marketing Automation'],
        selectedService: 'email-automation',
        selectedServiceName: 'Email & Marketing Automation',
        informationCollected: {},
        lastQuestionAsked: null,
        optionsOffered: [],
        selectedOption: null,
        discoveryQuestionsAsked: 0,
        pricingRequested: false,
        consultationRequested: true,
        benefitsExplained: true,
        pricingDiscussed: false,
        pendingBooking: {},
        status: 'in_progress',
      },
    }
    const db = createMockSupabase(schedulingState)

    const messages: ChatMessage[] = [
      { role: 'user', content: 'Option 1 please' }, // selecting proposed slot 1
    ]

    const result = await processConversationFlow({
      db,
      accountId: 'acct-opsiys-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      messages,
      config: baseConfig,
      contactName: 'David',
    })

    expect(result.bookedMeetingId).toBe('meeting-uuid-123')
    expect(result.state.currentStage).toBe('MEETING_BOOKED')
    expect(result.state.status).toBe('completed')
    expect(result.text).toContain('confirmed')
    expect(result.text).toContain('Wed, Oct 28')
  })

  it('Respects STOP/opt-out immediately without asking questions', async () => {
    const db = createMockSupabase()
    const messages: ChatMessage[] = [{ role: 'user', content: 'STOP messaging me' }]

    const result = await processConversationFlow({
      db,
      accountId: 'acct-any',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      messages,
      config: baseConfig,
    })

    expect(result.handoff).toBe(true)
    expect(result.state.currentStage).toBe('OPT_OUT')
    expect(result.state.status).toBe('paused')
    expect(result.text.toLowerCase()).toContain('unsubscribed')
  })

  it('Respects human agent request immediately', async () => {
    const db = createMockSupabase()
    const messages: ChatMessage[] = [{ role: 'user', content: 'Can I talk to a human agent please?' }]

    const result = await processConversationFlow({
      db,
      accountId: 'acct-any',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      messages,
      config: baseConfig,
    })

    expect(result.handoff).toBe(true)
    expect(result.state.currentStage).toBe('HUMAN_HANDOFF')
    expect(result.state.status).toBe('handed_off')
    expect(result.text).toContain('human team members')
  })

  it('Enforces discovery question limit: does not loop qualification forever', async () => {
    const db = createMockSupabase({
      flow_state: {
        currentFlow: 'service_to_conversion',
        currentStage: 'STAGE_A_UNDERSTAND',
        servicesIdentified: [],
        selectedService: null,
        selectedServiceName: null,
        informationCollected: {},
        lastQuestionAsked: 'What do you do?',
        optionsOffered: [],
        selectedOption: null,
        discoveryQuestionsAsked: 2, // limit of 2 reached!
        pricingRequested: false,
        consultationRequested: false,
        benefitsExplained: false,
        pricingDiscussed: false,
        pendingBooking: {},
        status: 'in_progress',
      },
    })

    const messages: ChatMessage[] = [
      { role: 'user', content: 'We are trying to grow our business' },
    ]

    const result = await processConversationFlow({
      db,
      accountId: 'acct-any',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      messages,
      config: baseConfig,
    })

    // Should NOT ask another discovery question; should present service options
    expect(result.text).toContain('Which of our core services would make the biggest difference')
  })

  describe('Work Email Collection & Multi-Turn Conversation Continuity', () => {
    const services: ServiceItem[] = [
      { id: 'srv-1', name: 'WhatsApp Automation & AI Chatbots', description: 'Automate WhatsApp conversations', keywords: ['whatsapp', 'bot'], benefits: ['save time and improve conversions'] },
      { id: 'srv-2', name: 'Email & Marketing Automation', description: 'Automate email marketing and campaigns', keywords: ['email', 'campaign'], benefits: ['nurture leads automatically'] },
      { id: 'srv-3', name: 'Modern Web & Application Development', description: 'Custom full-stack web applications', keywords: ['web', 'app'], benefits: ['high performance modern UI'] },
    ]

    it('matchServiceFromCatalog does not false-positive on customer stating their work email', () => {
      expect(matchServiceFromCatalog('siddharth@boyz.com', services)).toBeNull()
      expect(matchServiceFromCatalog('My work email is siddharth@boyz.com', services)).toBeNull()
      expect(matchServiceFromCatalog('Here is my email: siddharth@example.com', services)).toBeNull()
      expect(matchServiceFromCatalog('email: contact@company.io', services)).toBeNull()

      // Should still match when real email service intent is expressed
      const emailService = matchServiceFromCatalog('We need email marketing automation for our leads', services)
      expect(emailService).not.toBeNull()
      expect(emailService?.id).toBe('srv-2')
    })

    it('Traces complete multi-turn conversation past work-email step through service selection and pricing', async () => {
      const contactUpdates: Record<string, unknown> = {}
      let storedRow: Record<string, unknown> | null = null
      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'contacts') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'contact-1', user_id: 'user-1', name: 'Siddharth' }, error: null }),
                  }),
                }),
              }),
              update: vi.fn().mockImplementation((updates: Record<string, unknown>) => {
                Object.assign(contactUpdates, updates)
                return {
                  eq: vi.fn().mockResolvedValue({ error: null }),
                }
              }),
            }
          }
          if (table === 'conversations') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'conv-1', user_id: 'user-1' }, error: null }),
                  }),
                }),
              }),
            }
          }
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockImplementation(() =>
                  Promise.resolve({ data: storedRow, error: null }),
                ),
                single: vi.fn().mockImplementation(() =>
                  Promise.resolve({ data: storedRow, error: null }),
                ),
              }),
            }),
            insert: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
              storedRow = { id: 'qual-test-123', ...payload }
              return {
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: storedRow, error: null }),
                }),
              }
            }),
            update: vi.fn().mockImplementation((updates: Record<string, unknown>) => {
              storedRow = { ...storedRow, ...updates }
              return {
                eq: vi.fn().mockResolvedValue({ error: null }),
              }
            }),
          }
        }),
      } as unknown as SupabaseClient

      // Step 1: Customer sends work email in response to "Thanks Siddharth Pandey! What's your work email?"
      const messagesTurn1: ChatMessage[] = [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: "Welcome! What's your name?" },
        { role: 'user', content: 'Siddharth Pandey' },
        { role: 'assistant', content: "Thanks Siddharth Pandey! What's your work email?" },
        { role: 'user', content: 'siddharth@boyz.com' },
      ]

      const testConfig: AiConfig = {
        ...baseConfig,
        businessProfile: {
          ...DEFAULT_AI_BUSINESS_PROFILE,
          services,
        },
      }

      const resultTurn1 = await processConversationFlow({
        db: mockDb,
        accountId: 'acct-opsiys',
        conversationId: 'conv-123',
        contactId: 'contact-123',
        messages: messagesTurn1,
        config: testConfig,
        contactName: 'Siddharth Pandey',
      })

      // Verification 1: Email extracted & persisted to contacts table
      expect(resultTurn1.state.informationCollected['email']).toBe('siddharth@boyz.com')
      expect(contactUpdates.email).toBe('siddharth@boyz.com')

      // Verification 2: Does NOT false-positive match Email Marketing service
      expect(resultTurn1.state.selectedService).toBeNull()

      // Verification 3: Acknowledges email receipt by name, presents service catalog, and does NOT hand off or halt
      expect(resultTurn1.handoff).toBe(false)
      expect(resultTurn1.text).toContain('Thanks Siddharth Pandey!')
      expect(resultTurn1.text).toContain('noted your work email (siddharth@boyz.com)')
      expect(resultTurn1.text).toContain('Which of our core services would make the biggest difference')
      expect(resultTurn1.state.currentStage).toBe('STAGE_A_UNDERSTAND')

      // Step 2: Customer replies with service selection (e.g. "1" or "WhatsApp Automation")
      const messagesTurn2: ChatMessage[] = [
        ...messagesTurn1,
        { role: 'assistant', content: resultTurn1.text },
        { role: 'user', content: 'WhatsApp Automation' },
      ]

      const resultTurn2 = await processConversationFlow({
        db: mockDb,
        accountId: 'acct-opsiys',
        conversationId: 'conv-123',
        contactId: 'contact-123',
        messages: messagesTurn2,
        config: testConfig,
        contactName: 'Siddharth Pandey',
      })

      // Verification 4: Clean transition to STAGE_B_ACKNOWLEDGE_SERVICE
      expect(resultTurn2.handoff).toBe(false)
      expect(resultTurn2.state.currentStage).toBe('STAGE_B_ACKNOWLEDGE_SERVICE')
      expect(resultTurn2.state.selectedServiceName).toContain('WhatsApp Automation')
      expect(resultTurn2.text).toContain('1. Explore pricing')
      expect(resultTurn2.text).toContain('2. Book a consultation')

      // Step 3: Customer replies with "1" to explore pricing
      const messagesTurn3: ChatMessage[] = [
        ...messagesTurn2,
        { role: 'assistant', content: resultTurn2.text },
        { role: 'user', content: '1' },
      ]

      const resultTurn3 = await processConversationFlow({
        db: mockDb,
        accountId: 'acct-opsiys',
        conversationId: 'conv-123',
        contactId: 'contact-123',
        messages: messagesTurn3,
        config: testConfig,
        contactName: 'Siddharth Pandey',
      })

      // Verification 5: Clean transition to STAGE_C_PRICING without halting
      expect(resultTurn3.handoff).toBe(false)
      expect(resultTurn3.state.currentStage).toBe('STAGE_C_PRICING')
      expect(resultTurn3.text).toBeTruthy()
    })
  })
})
