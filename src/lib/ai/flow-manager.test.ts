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
    from: vi.fn().mockImplementation((_table: string) => ({
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
})
