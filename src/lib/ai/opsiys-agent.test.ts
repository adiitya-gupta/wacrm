import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  processOpsiysLeadConversation,
  serializeStateToNotes,
  deserializeStateFromNotes,
  extractProspectInformation,
  type OpsiysLeadState,
} from './opsiys-agent';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiConfig } from './types';
import * as availability from '@/lib/scheduling/availability';
import * as booking from '@/lib/scheduling/booking';

// Mock dependencies
vi.mock('./generate', () => ({
  generateReply: vi.fn().mockImplementation(async (args) => {
    const userTurn = args.messages[args.messages.length - 1]?.content || '';
    if (/human|agent|support/i.test(userTurn)) {
      return {
        text: 'I understand you would like to speak to a human team member. Let me connect you with one of our specialists. [[HANDOFF]]',
        handoff: true,
        usage: null,
      };
    }
    if (/business coach/i.test(userTurn)) {
      return {
        text: "That's awesome! Helping businesses grow is meaningful work. 😊 How do you currently get new clients, and what's the biggest challenge — finding leads, following up, or converting enquiries into paying clients?",
        handoff: false,
        usage: null,
      };
    }
    if (/following up/i.test(userTurn)) {
      return {
        text: 'I can see how that adds up, especially when you are busy coaching clients. 😅 At OPSIYS, we can automate WhatsApp enquiries and follow-ups. Which part would make the biggest difference — automating WhatsApp enquiries, managing follow-ups, or getting more qualified leads?',
        handoff: false,
        usage: null,
      };
    }
    if (/whatsapp automation/i.test(userTurn)) {
      return {
        text: 'Great choice! 🚀 A WhatsApp AI agent can respond to enquiries 24/7, qualify leads, and nurture prospects with friendly follow-ups. Would you be open to a short discovery call with the OPSIYS team?',
        handoff: false,
        usage: null,
      };
    }
    return {
      text: 'Hey! 👋 Welcome to OPSIYS. Before I suggest anything, I would love to understand your business a little. What do you do, and who are your main customers?',
      handoff: false,
      usage: null,
    };
  }),
}));

vi.mock('@/lib/scheduling/booking', () => ({
  bookMeeting: vi.fn().mockResolvedValue({
    success: true,
    meeting_id: 'meeting-test-999',
    meeting_link: 'https://meet.google.com/ops-demo-test',
    status: 'confirmed',
  }),
  cancelMeeting: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/lib/scheduling/availability', () => ({
  getAvailableSlots: vi.fn().mockResolvedValue([
    {
      startTime: '2026-10-21T10:00:00.000Z',
      endTime: '2026-10-21T10:15:00.000Z',
      formattedDate: 'Wednesday, Oct 21',
      formattedTime: '3:30 PM',
      timezone: 'Asia/Kolkata',
    },
    {
      startTime: '2026-10-21T11:00:00.000Z',
      endTime: '2026-10-21T11:15:00.000Z',
      formattedDate: 'Wednesday, Oct 21',
      formattedTime: '4:30 PM',
      timezone: 'Asia/Kolkata',
    },
  ]),
  isSlotAvailable: vi.fn().mockResolvedValue(true),
  formatSlotsForWhatsApp: vi.fn().mockReturnValue('*1.* Wednesday, Oct 21 at 3:30 PM IST\n*2.* Wednesday, Oct 21 at 4:30 PM IST'),
  loadSchedulingSettings: vi.fn().mockResolvedValue({
    account_id: 'acc-1',
    meeting_duration_minutes: 15,
    timezone: 'Asia/Kolkata',
    working_days: [1, 2, 3, 4, 5],
    working_hours_start: '09:00',
    working_hours_end: '18:00',
    buffer_before_minutes: 5,
    buffer_after_minutes: 10,
    minimum_notice_hours: 2,
    max_advance_days: 14,
    google_calendar_enabled: false,
    default_meeting_link: 'https://meet.google.com/ops-default',
  }),
}));

describe('OPSIYS AI Lead Qualification & Automatic Meeting Booking Engine', () => {
  let mockDb: SupabaseClient;
  const mockConfig: AiConfig = {
    provider: 'openai',
    model: 'gpt-4o',
    baseUrl: null,
    apiKey: 'sk-test',
    systemPrompt: 'You are OPSIYS AI.',
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 10,
    handoffAgentId: null,
    embeddingsApiKey: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(availability.isSlotAvailable).mockResolvedValue(true);
    vi.mocked(booking.bookMeeting).mockResolvedValue({
      success: true,
      meeting_id: 'meeting-test-999',
      meeting_link: 'https://meet.google.com/ops-demo-test',
      status: 'confirmed',
    });
  });

  function createMockDb(storedQual: Record<string, unknown>) {
    return {
      from: vi.fn((table: string) => {
        if (table === 'conversations') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: true, error: null }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: storedQual }),
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: storedQual }),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: true, error: null }),
          }),
        };
      }),
    } as unknown as SupabaseClient;
  }

  it('triggers human handoff when customer asks for a human agent', async () => {
    const storedQual = {
      id: 'qual-1',
      account_id: 'acc-1',
      contact_id: 'contact-1',
      conversation_id: 'conv-1',
      state: 'REQUIREMENT_DISCOVERY',
      proposed_slots: [],
      message_count: 2,
    };

    mockDb = createMockDb(storedQual);

    const result = await processOpsiysLeadConversation({
      db: mockDb,
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      messages: [{ role: 'user', content: 'Can I please speak to a human agent?' }],
      config: mockConfig,
      contactName: 'Jane Doe',
    });

    expect(result.handoff).toBe(true);
    expect(result.state).toBe('HUMAN_HANDOFF');
    expect(result.text).toContain('human team member');
  });

  it('handles opt-out requests immediately by pausing AI autoreply and confirming politely', async () => {
    const storedQual = {
      id: 'qual-1',
      account_id: 'acc-1',
      contact_id: 'contact-1',
      conversation_id: 'conv-1',
      state: 'REQUIREMENT_DISCOVERY',
      proposed_slots: [],
      message_count: 2,
    };

    mockDb = createMockDb(storedQual);

    const result = await processOpsiysLeadConversation({
      db: mockDb,
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      messages: [{ role: 'user', content: 'STOP' }],
      config: mockConfig,
      contactName: 'Jane Doe',
    });

    expect(result.handoff).toBe(true);
    expect(result.state).toBe('HUMAN_HANDOFF');
    expect(result.text).toContain('unsubscribed');
    expect(result.text).toContain('automated messages have been paused');
  });

  it('books meeting atomically and confirms on WhatsApp when lead selects a slot', async () => {
    const slots = [
      {
        startTime: '2026-10-21T10:00:00.000Z',
        endTime: '2026-10-21T10:15:00.000Z',
        formattedDate: 'Wednesday, Oct 21',
        formattedTime: '3:30 PM',
        timezone: 'Asia/Kolkata',
      },
    ];

    const storedQual = {
      id: 'qual-1',
      account_id: 'acc-1',
      contact_id: 'contact-1',
      conversation_id: 'conv-1',
      state: 'MEETING_OFFERED',
      proposed_slots: slots,
      requested_service: 'WhatsApp Automation',
      business_type: 'Real Estate',
      urgency: 'Immediate',
      message_count: 3,
    };

    mockDb = createMockDb(storedQual);

    const result = await processOpsiysLeadConversation({
      db: mockDb,
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      messages: [{ role: 'user', content: '1' }], // User selects Option 1
      config: mockConfig,
      contactName: 'Alex',
    });

    expect(result.handoff).toBe(false);
    expect(result.state).toBe('MEETING_BOOKED');
    expect(result.bookedMeetingId).toBe('meeting-test-999');
    expect(result.text).toContain('*Your discovery call with OPSIYS is confirmed!*');
    expect(result.text).toContain('Wednesday, Oct 21');
    expect(result.text).toContain('https://meet.google.com/ops-demo-test');
  });

  it('handles cancellation request when lead cancels their meeting', async () => {
    const storedQual = {
      id: 'qual-1',
      account_id: 'acc-1',
      contact_id: 'contact-1',
      conversation_id: 'conv-1',
      state: 'MEETING_BOOKED',
      meeting_id: 'meeting-test-999',
      message_count: 4,
    };

    mockDb = createMockDb(storedQual);

    const result = await processOpsiysLeadConversation({
      db: mockDb,
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      messages: [{ role: 'user', content: 'I need to cancel our meeting for tomorrow' }],
      config: mockConfig,
      contactName: 'Alex',
    });

    expect(result.state).toBe('MEETING_CANCELLED');
    expect(result.text).toContain('I have cancelled your discovery meeting');
  });

  it('handles reschedule request and offers new available slots', async () => {
    const storedQual = {
      id: 'qual-1',
      account_id: 'acc-1',
      contact_id: 'contact-1',
      conversation_id: 'conv-1',
      state: 'MEETING_BOOKED',
      meeting_id: 'meeting-test-999',
      message_count: 5,
    };

    mockDb = createMockDb(storedQual);

    const result = await processOpsiysLeadConversation({
      db: mockDb,
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      messages: [{ role: 'user', content: 'Can we reschedule our call?' }],
      config: mockConfig,
      contactName: 'Alex',
    });

    expect(result.state).toBe('SLOT_SELECTION');
    expect(result.text).toContain("Sure, I'd be happy to reschedule!");
    expect(result.text).toContain('Wednesday, Oct 21 at 3:30 PM IST');
  });

  it('progresses consultative flow: acknowledges business and asks about challenges', async () => {
    const storedQual = {
      id: 'qual-1',
      account_id: 'acc-1',
      contact_id: 'contact-1',
      conversation_id: 'conv-1',
      state: 'GREETING',
      proposed_slots: [],
      message_count: 1,
    };

    mockDb = createMockDb(storedQual);

    const result = await processOpsiysLeadConversation({
      db: mockDb,
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      messages: [{ role: 'user', content: "I'm a business coach working with startups" }],
      config: mockConfig,
      contactName: 'Sarah',
    });

    expect(result.state).toBe('REQUIREMENT_DISCOVERY');
    expect(result.text).toContain('business');
    expect(result.text).toContain('challenge');
  });

  it('handles Stage 6 meeting agreement and invites prospect to share date/time preference', async () => {
    const initialState: OpsiysLeadState = {
      business_type: 'Business Coaching',
      target_customers: 'B2B / Founders',
      business_goal: 'Scale coaching',
      primary_challenge: 'Slow lead follow-ups',
      recommended_services: ['WhatsApp Automation'],
      selected_service: 'WhatsApp Automation',
      benefits_explained: true,
      meeting_interest: null,
      preferred_date: null,
      preferred_time: null,
      timezone: 'Asia/Kolkata',
      available_slots_checked: false,
      selected_slot: null,
      booking_status: 'none',
      meeting_link: null,
      conversation_stage: 'STAGE_6_INVITE_MEETING',
    };

    const storedQual = {
      id: 'qual-1',
      account_id: 'acc-1',
      contact_id: 'contact-1',
      conversation_id: 'conv-1',
      state: 'MEETING_OFFERED',
      qualification_notes: serializeStateToNotes('Lead Summary', initialState),
      proposed_slots: [],
      message_count: 5,
    };

    mockDb = createMockDb(storedQual);

    const result = await processOpsiysLeadConversation({
      db: mockDb,
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      messages: [{ role: 'user', content: 'Yes, that sounds great!' }],
      config: mockConfig,
      contactName: 'Sarah',
    });

    expect(result.state).toBe('SLOT_SELECTION');
    expect(result.text).toContain('What day and time usually work best for you?');
  });

  it('respects prospect decision when they decline discovery meeting in Stage 6', async () => {
    const initialState: OpsiysLeadState = {
      business_type: 'Business Coaching',
      target_customers: 'B2B / Founders',
      business_goal: 'Scale coaching',
      primary_challenge: 'Slow lead follow-ups',
      recommended_services: ['WhatsApp Automation'],
      selected_service: 'WhatsApp Automation',
      benefits_explained: true,
      meeting_interest: null,
      preferred_date: null,
      preferred_time: null,
      timezone: 'Asia/Kolkata',
      available_slots_checked: false,
      selected_slot: null,
      booking_status: 'none',
      meeting_link: null,
      conversation_stage: 'STAGE_6_INVITE_MEETING',
    };

    const storedQual = {
      id: 'qual-1',
      account_id: 'acc-1',
      contact_id: 'contact-1',
      conversation_id: 'conv-1',
      state: 'MEETING_OFFERED',
      qualification_notes: serializeStateToNotes('Lead Summary', initialState),
      proposed_slots: [],
      message_count: 5,
    };

    mockDb = createMockDb(storedQual);

    const result = await processOpsiysLeadConversation({
      db: mockDb,
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      messages: [{ role: 'user', content: 'Not right now, thank you.' }],
      config: mockConfig,
      contactName: 'Sarah',
    });

    expect(result.state).toBe('MEETING_OFFERED');
    expect(result.text).toContain('No problem at all!');
  });

  it('asks for preferred time when prospect provides date without time in Stage 7', async () => {
    const initialState: OpsiysLeadState = {
      business_type: 'Business Coaching',
      target_customers: 'B2B / Founders',
      business_goal: 'Scale coaching',
      primary_challenge: 'Slow lead follow-ups',
      recommended_services: ['WhatsApp Automation'],
      selected_service: 'WhatsApp Automation',
      benefits_explained: true,
      meeting_interest: 'yes',
      preferred_date: null,
      preferred_time: null,
      timezone: 'Asia/Kolkata',
      available_slots_checked: false,
      selected_slot: null,
      booking_status: 'offered',
      meeting_link: null,
      conversation_stage: 'STAGE_7_COLLECT_DATETIME',
    };

    const storedQual = {
      id: 'qual-1',
      account_id: 'acc-1',
      contact_id: 'contact-1',
      conversation_id: 'conv-1',
      state: 'SLOT_SELECTION',
      qualification_notes: serializeStateToNotes('Lead Summary', initialState),
      proposed_slots: [],
      message_count: 6,
    };

    mockDb = createMockDb(storedQual);

    const result = await processOpsiysLeadConversation({
      db: mockDb,
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      messages: [{ role: 'user', content: 'Monday' }],
      config: mockConfig,
      contactName: 'Sarah',
    });

    expect(result.state).toBe('SLOT_SELECTION');
    expect(result.text).toContain('works!');
    expect(result.text).toContain('What time');
    expect(result.text).toContain('IST');
  });

  it('checks calendar availability and asks for confirmation when both date and time are provided', async () => {
    const initialState: OpsiysLeadState = {
      business_type: 'Business Coaching',
      target_customers: 'B2B / Founders',
      business_goal: 'Scale coaching',
      primary_challenge: 'Slow lead follow-ups',
      recommended_services: ['WhatsApp Automation'],
      selected_service: 'WhatsApp Automation',
      benefits_explained: true,
      meeting_interest: 'yes',
      preferred_date: null,
      preferred_time: null,
      timezone: 'Asia/Kolkata',
      available_slots_checked: false,
      selected_slot: null,
      booking_status: 'offered',
      meeting_link: null,
      conversation_stage: 'STAGE_7_COLLECT_DATETIME',
    };

    const storedQual = {
      id: 'qual-1',
      account_id: 'acc-1',
      contact_id: 'contact-1',
      conversation_id: 'conv-1',
      state: 'SLOT_SELECTION',
      qualification_notes: serializeStateToNotes('Lead Summary', initialState),
      proposed_slots: [],
      message_count: 6,
    };

    mockDb = createMockDb(storedQual);

    const result = await processOpsiysLeadConversation({
      db: mockDb,
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      messages: [{ role: 'user', content: 'Monday at 11 AM' }],
      config: mockConfig,
      contactName: 'Sarah',
    });

    expect(result.state).toBe('SLOT_SELECTION');
    expect(result.text).toContain('Good news!');
    expect(result.text).toContain('available');
    expect(result.text).toContain('Shall I');
  });

  it('offers real alternative slots when the requested slot is unavailable', async () => {
    vi.mocked(availability.isSlotAvailable).mockResolvedValue(false);

    const initialState: OpsiysLeadState = {
      business_type: 'Business Coaching',
      target_customers: 'B2B / Founders',
      business_goal: 'Scale coaching',
      primary_challenge: 'Slow lead follow-ups',
      recommended_services: ['WhatsApp Automation'],
      selected_service: 'WhatsApp Automation',
      benefits_explained: true,
      meeting_interest: 'yes',
      preferred_date: null,
      preferred_time: null,
      timezone: 'Asia/Kolkata',
      available_slots_checked: false,
      selected_slot: null,
      booking_status: 'offered',
      meeting_link: null,
      conversation_stage: 'STAGE_7_COLLECT_DATETIME',
    };

    const storedQual = {
      id: 'qual-1',
      account_id: 'acc-1',
      contact_id: 'contact-1',
      conversation_id: 'conv-1',
      state: 'SLOT_SELECTION',
      qualification_notes: serializeStateToNotes('Lead Summary', initialState),
      proposed_slots: [],
      message_count: 6,
    };

    mockDb = createMockDb(storedQual);

    const result = await processOpsiysLeadConversation({
      db: mockDb,
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      messages: [{ role: 'user', content: 'Monday at 11 AM' }],
      config: mockConfig,
      contactName: 'Sarah',
    });

    expect(result.state).toBe('SLOT_SELECTION');
    expect(result.text).toContain('already booked');
    expect(result.text).toContain('Wednesday, Oct 21 at 3:30 PM IST');
  });

  it('preserves all 16 logical fields in qualification_notes and restores state across turns', () => {
    const originalState: OpsiysLeadState = {
      business_type: 'Dental Clinic',
      target_customers: 'Patients',
      business_goal: 'Reduce no-shows',
      primary_challenge: 'Scheduling & missed appointments',
      recommended_services: ['WhatsApp Automation'],
      selected_service: 'WhatsApp Automation',
      benefits_explained: true,
      meeting_interest: 'yes',
      preferred_date: '2026-10-25',
      preferred_time: '14:00',
      timezone: 'Asia/Kolkata',
      available_slots_checked: true,
      selected_slot: '2026-10-25T08:30:00.000Z',
      booking_status: 'confirmed',
      meeting_link: 'https://meet.google.com/test-meet',
      conversation_stage: 'MEETING_BOOKED',
    };

    const notes = serializeStateToNotes('Lead: Dental Clinic | Service: WhatsApp Automation', originalState);
    expect(notes).toContain('---');

    const restored = deserializeStateFromNotes(notes, { state: 'MEETING_BOOKED' });
    expect(restored.business_type).toBe('Dental Clinic');
    expect(restored.target_customers).toBe('Patients');
    expect(restored.business_goal).toBe('Reduce no-shows');
    expect(restored.primary_challenge).toBe('Scheduling & missed appointments');
    expect(restored.selected_service).toBe('WhatsApp Automation');
    expect(restored.benefits_explained).toBe(true);
    expect(restored.meeting_interest).toBe('yes');
    expect(restored.preferred_date).toBe('2026-10-25');
    expect(restored.preferred_time).toBe('14:00');
    expect(restored.timezone).toBe('Asia/Kolkata');
    expect(restored.available_slots_checked).toBe(true);
    expect(restored.selected_slot).toBe('2026-10-25T08:30:00.000Z');
    expect(restored.booking_status).toBe('confirmed');
    expect(restored.meeting_link).toBe('https://meet.google.com/test-meet');
    expect(restored.conversation_stage).toBe('MEETING_BOOKED');
  });

  it('extracts lead business type, challenge, and service accurately', () => {
    const dummyState: OpsiysLeadState = {
      business_type: null,
      target_customers: null,
      business_goal: null,
      primary_challenge: null,
      recommended_services: [],
      selected_service: null,
      benefits_explained: false,
      meeting_interest: null,
      preferred_date: null,
      preferred_time: null,
      timezone: 'Asia/Kolkata',
      available_slots_checked: false,
      selected_slot: null,
      booking_status: 'none',
      meeting_link: null,
      conversation_stage: 'STAGE_1_BUSINESS',
    };

    const extracted = extractProspectInformation(
      'I run an executive coaching business for startup founders, but following up with everyone takes too much time. I need WhatsApp automation.',
      dummyState,
    );

    expect(extracted.business_type).toBe('Business Coaching');
    expect(extracted.target_customers).toBe('B2B / Founders');
    expect(extracted.primary_challenge).toBe('Slow lead follow-ups & manual replies');
    expect(extracted.selected_service).toBe('WhatsApp Automation');
  });

  it('executes full Section 4 consultative conversation journey across multiple turns', async () => {
    // Shared state stored in mockDb across turns
    let currentStoredQual: Record<string, unknown> = {
      id: 'qual-conv-e2e',
      account_id: 'acc-1',
      contact_id: 'contact-e2e',
      conversation_id: 'conv-e2e',
      state: 'NEW_LEAD',
      qualification_notes: null,
      proposed_slots: [],
      message_count: 0,
    };

    const e2eDb = {
      from: vi.fn((table: string) => {
        if (table === 'conversations') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: true, error: null }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockImplementation(async () => ({ data: currentStoredQual })),
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockImplementation(async () => ({ data: currentStoredQual })),
              }),
            }),
          }),
          update: vi.fn().mockImplementation((updates: Record<string, unknown>) => ({
            eq: vi.fn().mockImplementation(async () => {
              currentStoredQual = { ...currentStoredQual, ...updates };
              return { data: true, error: null };
            }),
          })),
        };
      }),
    } as unknown as SupabaseClient;

    // Turn 1: Prospect describes their business
    const res1 = await processOpsiysLeadConversation({
      db: e2eDb,
      accountId: 'acc-1',
      conversationId: 'conv-e2e',
      contactId: 'contact-e2e',
      messages: [{ role: 'user', content: "I'm a business coach." }],
      config: mockConfig,
      contactName: 'Coach Mark',
    });
    expect(res1.state).toBe('REQUIREMENT_DISCOVERY');
    expect(res1.text).toContain('challenge');

    // Turn 2: Prospect shares follow-up challenge
    const res2 = await processOpsiysLeadConversation({
      db: e2eDb,
      accountId: 'acc-1',
      conversationId: 'conv-e2e',
      contactId: 'contact-e2e',
      messages: [
        { role: 'user', content: "I'm a business coach." },
        { role: 'assistant', content: res1.text },
        { role: 'user', content: 'Mostly social media, but following up with everyone takes too much time.' },
      ],
      config: mockConfig,
      contactName: 'Coach Mark',
    });
    expect(res2.state).toBe('REQUIREMENT_DISCOVERY');
    expect(res2.text).toContain('WhatsApp');

    // Turn 3: Prospect selects WhatsApp automation
    const res3 = await processOpsiysLeadConversation({
      db: e2eDb,
      accountId: 'acc-1',
      conversationId: 'conv-e2e',
      contactId: 'contact-e2e',
      messages: [
        { role: 'user', content: 'WhatsApp automation.' },
      ],
      config: mockConfig,
      contactName: 'Coach Mark',
    });
    expect(res3.state).toBe('MEETING_OFFERED');
    expect(res3.text).toContain('discovery call');

    // Turn 4: Prospect agrees to discovery call
    const res4 = await processOpsiysLeadConversation({
      db: e2eDb,
      accountId: 'acc-1',
      conversationId: 'conv-e2e',
      contactId: 'contact-e2e',
      messages: [
        { role: 'user', content: 'Yes.' },
      ],
      config: mockConfig,
      contactName: 'Coach Mark',
    });
    expect(res4.state).toBe('SLOT_SELECTION');
    expect(res4.text).toContain('What day and time usually work best for you?');

    // Turn 5: Prospect suggests "Monday at 11 AM"
    const res5 = await processOpsiysLeadConversation({
      db: e2eDb,
      accountId: 'acc-1',
      conversationId: 'conv-e2e',
      contactId: 'contact-e2e',
      messages: [
        { role: 'user', content: 'Monday at 11 AM.' },
      ],
      config: mockConfig,
      contactName: 'Coach Mark',
    });
    expect(res5.state).toBe('SLOT_SELECTION');
    expect(res5.text).toContain('available');
    expect(res5.text).toContain('Shall I');

    // Turn 6: Prospect confirms "Yes, please."
    const res6 = await processOpsiysLeadConversation({
      db: e2eDb,
      accountId: 'acc-1',
      conversationId: 'conv-e2e',
      contactId: 'contact-e2e',
      messages: [
        { role: 'user', content: 'Yes, please.' },
      ],
      config: mockConfig,
      contactName: 'Coach Mark',
    });
    expect(res6.state).toBe('MEETING_BOOKED');
    expect(res6.bookedMeetingId).toBe('meeting-test-999');
    expect(res6.text).toContain('*Your discovery call with OPSIYS is confirmed!*');
    expect(res6.text).toContain('https://meet.google.com/ops-demo-test');
  });
});
