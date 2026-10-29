import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AiConfig,
  AiBusinessProfile,
  AiConversationFlowConfig,
  AiMessageTemplates,
  ChatMessage,
  DeterministicFlowState,
  FlowPresetType,
  ServiceItem,
  PricingPackage,
} from './types'
import {
  DEFAULT_AI_BUSINESS_PROFILE,
  OPSIYS_DEFAULT_BUSINESS_PROFILE,
  DEFAULT_AI_CONVERSATION_FLOW,
  DEFAULT_AI_MESSAGE_TEMPLATES,
  HANDOFF_SENTINEL,
} from './defaults'
import { renderTemplate, getEffectiveTemplate } from './templates'
import {
  parseNaturalDateTime,
  isAffirmativeResponse,
  isNegativeResponse,
} from '@/lib/scheduling/nlp-datetime'
import {
  getAvailableSlots,
  isSlotAvailable,
  formatSlotsForWhatsApp,
  loadSchedulingSettings,
} from '@/lib/scheduling/availability'
import { bookMeeting, cancelMeeting } from '@/lib/scheduling/booking'
import { generateReply } from './generate'
import { dispatchAiOutcomeEvent } from './events'
import type { TimeSlot } from '@/types/meetings'

export interface FlowManagerArgs {
  db: SupabaseClient
  accountId: string
  conversationId: string
  contactId: string
  messages: ChatMessage[]
  config: AiConfig
  contactName?: string | null
  contactPhone?: string | null
}

export interface FlowManagerResult {
  text: string
  handoff: boolean
  state: DeterministicFlowState
  bookedMeetingId?: string
  leadSummary?: string
}

// Regex patterns for intent detection
export const OPT_OUT_REGEX =
  /\b(stop|unsubscribe|opt[\s-]?out|cancel\s+subscription|remove\s+me|don'?t\s+message\s+me)\b/i

export const HUMAN_REQUEST_REGEX =
  /\b(human|agent|person|representative|support|talk to someone|speak (to|with) someone|speak to a person|operator)\b/i

export const PRICING_INTENT_REGEX =
  /\b(pricing|price|prices|cost|costs|rate|rates|package|packages|how much|fee|fees|quote|quotation|explore pricing|option 1|^1$)\b/i

export const CONSULTATION_INTENT_REGEX =
  /\b(consultation|meeting|call|demo|schedule|book|calendar|appointment|discuss|talk to team|book a consultation|option 2|^2$)\b/i

/**
 * Resolve effective business profile for a tenant.
 */
export function resolveEffectiveBusinessProfile(
  config: AiConfig,
  accountId: string,
): AiBusinessProfile {
  if (
    config.businessProfile &&
    config.businessProfile.businessName &&
    config.businessProfile.services &&
    config.businessProfile.services.length > 0
  ) {
    return config.businessProfile
  }
  const opsiysId = process.env.OPSIYS_ACCOUNT_ID?.trim()
  if (opsiysId && accountId === opsiysId) {
    return OPSIYS_DEFAULT_BUSINESS_PROFILE
  }
  return DEFAULT_AI_BUSINESS_PROFILE
}

/**
 * Resolve effective conversation flow config for a tenant.
 */
export function resolveEffectiveFlowConfig(
  config: AiConfig,
): AiConversationFlowConfig {
  if (config.conversationFlow && config.conversationFlow.preset) {
    return {
      ...DEFAULT_AI_CONVERSATION_FLOW,
      ...config.conversationFlow,
    }
  }
  return DEFAULT_AI_CONVERSATION_FLOW
}

export const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i

/**
 * Find matching service from tenant catalog based on user input.
 */
export function matchServiceFromCatalog(
  text: string,
  services: ServiceItem[],
): ServiceItem | null {
  if (!text || services.length === 0) return null
  const lower = text.toLowerCase()

  // 0. Direct ID match
  for (const s of services) {
    if (s.id && (s.id === text || s.id.toLowerCase() === lower)) {
      return s
    }
  }

  const isStatingEmail =
    EMAIL_REGEX.test(text) ||
    lower.includes('work email') ||
    lower.includes('my email') ||
    lower.startsWith('email:') ||
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim())

  const hasEmailServiceIntent =
    lower.includes('email marketing') ||
    lower.includes('email automation') ||
    lower.includes('email campaign') ||
    lower.includes('cold email') ||
    lower.includes('newsletter')

  // 1. Direct name match or reverse substring
  for (const s of services) {
    const sLower = s.name.toLowerCase()
    if (sLower.includes('email') && isStatingEmail && !hasEmailServiceIntent) {
      continue
    }
    if (lower.includes(sLower) || sLower.includes(lower)) {
      return s
    }
  }

  // 2. Keyword match (with word boundaries to avoid substring false-positives like 'unmapped' matching 'app')
  for (const s of services) {
    if (s.keywords && s.keywords.length > 0) {
      for (const kw of s.keywords) {
        const kwLower = kw.toLowerCase()
        if (kwLower === 'email' && isStatingEmail && !hasEmailServiceIntent) {
          continue
        }
        const kwRegex = new RegExp(`(^|[^a-z0-9])${kwLower.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}([^a-z0-9]|$)`, 'i')
        if (kwRegex.test(lower)) {
          return s
        }
      }
    }
  }

  // 3. Tokenized word overlap match (e.g. "Marketing & SEO" vs "SEO & Digital Marketing", "AI & Automation" vs "AI & Business Automation", "Web & Development" vs "Website & Web Application Development")
  const stopWords = new Set(['and', '&', 'the', 'for', 'our', 'with', 'your', 'services', 'solutions', 'package', 'packages'])
  const inputTokens = lower
    .split(/[\s/,&+]+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length >= 2 && !stopWords.has(w))

  if (inputTokens.length > 0) {
    let bestService: ServiceItem | null = null
    let maxOverlap = 0

    for (const s of services) {
      const sTokens = s.name
        .toLowerCase()
        .split(/[\s/,&+]+/)
        .map((w) => w.replace(/[^a-z0-9]/g, ''))
        .filter((w) => w.length >= 2 && !stopWords.has(w))

      const kwTokens = (s.keywords || [])
        .map((k) => k.toLowerCase().replace(/[^a-z0-9]/g, ''))
        .filter((w) => w.length >= 2 && !stopWords.has(w))

      const allSTokens = new Set([...sTokens, ...kwTokens])

      let overlap = 0
      for (const tok of inputTokens) {
        if (tok === 'email' && isStatingEmail && !hasEmailServiceIntent) {
          continue
        }
        const match = Array.from(allSTokens).some(
          (st) =>
            st === tok ||
            (tok.length >= 3 && st.startsWith(tok.slice(0, 3))) ||
            (st.length >= 3 && tok.startsWith(st.slice(0, 3))),
        )
        if (match) overlap++
      }

      if (overlap > maxOverlap) {
        maxOverlap = overlap
        bestService = s
      }
    }

    if (bestService && maxOverlap >= 1) {
      return bestService
    }
  }

  // 4. Common industry pattern match
  for (const s of services) {
    const sLower = s.name.toLowerCase()
    const matchesEmailPattern =
      sLower.includes('email') &&
      (hasEmailServiceIntent || (!isStatingEmail && lower.includes('email')))

    if (
      matchesEmailPattern ||
      (lower.includes('whatsapp') && sLower.includes('whatsapp')) ||
      (lower.includes('lead') && sLower.includes('lead')) ||
      (lower.includes('bot') && (sLower.includes('bot') || sLower.includes('agent'))) ||
      (lower.includes('website') && (sLower.includes('web') || sLower.includes('site'))) ||
      (lower.includes('crm') && sLower.includes('crm'))
    ) {
      return s
    }
  }

  return null
}

/**
 * Format verified pricing packages for WhatsApp display.
 */
export function formatPricingPackages(
  packages: PricingPackage[],
  selectedServiceId?: string | null,
): string {
  if (!packages || packages.length === 0) {
    return 'Pricing is customized based on your specific scope and requirements.'
  }

  // Filter packages for selected service if applicable
  const relevant = selectedServiceId
    ? packages.filter((p) => !p.serviceId || p.serviceId === selectedServiceId)
    : packages

  const pkgs = relevant.length > 0 ? relevant : packages

  return pkgs
    .map((p) => {
      const period = p.billingPeriod ? ` (${p.billingPeriod})` : ''
      const desc = p.description ? `\n  ${p.description}` : ''
      return `• *${p.name}*: ${p.price}${period}${desc}`
    })
    .join('\n\n')
}

/**
 * Core Multi-Tenant Deterministic Conversation Flow Manager.
 */
export async function processConversationFlow(
  args: FlowManagerArgs,
): Promise<FlowManagerResult> {
  const { db, accountId, conversationId, contactId, messages, config, contactName } = args

  const profile = resolveEffectiveBusinessProfile(config, accountId)
  const flowConfig = resolveEffectiveFlowConfig(config)
  const templates = config.messageTemplates || DEFAULT_AI_MESSAGE_TEMPLATES

  // 1. Load or initialize qualification / flow state
  const qualificationRecord = await loadOrCreateQualification(
    db,
    accountId,
    contactId,
    conversationId,
  )

  const settings = await loadSchedulingSettings(db, accountId)
  const tz = settings.timezone || 'Asia/Kolkata'

  // Deserialize deterministic state
  const state: DeterministicFlowState = deserializeFlowState(
    qualificationRecord,
    flowConfig.preset,
  )

  // Synchronize state.selectedService and state.selectedServiceName with the tenant's authoritative catalog.
  // Purge any stale or obsolete service (e.g. from an old fallback 'General Consultation & Services' or previous test)
  if (state.selectedService || state.selectedServiceName) {
    const authoritative = profile.services.find(
      (s) =>
        (state.selectedService && s.id === state.selectedService) ||
        (state.selectedServiceName && s.name.toLowerCase() === state.selectedServiceName.toLowerCase()),
    )
    if (authoritative) {
      state.selectedService = authoritative.id
      state.selectedServiceName = authoritative.name
    } else {
      console.info('[flow-manager] purged obsolete non-catalog service from state:', {
        accountId,
        staleId: state.selectedService,
        staleName: state.selectedServiceName,
      })
      state.selectedService = null
      state.selectedServiceName = null
      state.benefitsExplained = false
      state.optionsOffered = []
      state.selectedOption = null
    }
  }

  const lastUserTurn = [...messages].reverse().find((m) => m.role === 'user')
  const userText = (lastUserTurn?.content || '').trim()
  const lowerUserText = userText.toLowerCase()
  const now = new Date()

  let effectiveContactName = contactName || (state.informationCollected['name'] as string) || null

  // Extract contact information (email, name)
  const emailMatch = userText.match(EMAIL_REGEX)
  let extractedEmail: string | null = null
  if (emailMatch) {
    extractedEmail = emailMatch[0].trim()
    state.informationCollected['email'] = extractedEmail
    void Promise.resolve(
      db
        .from('contacts')
        .update({ email: extractedEmail, updated_at: new Date().toISOString() })
        .eq('id', contactId)
    ).catch((err: unknown) => console.warn('[flow-manager] failed to update contact email:', err))
  }

  const priorAssistantTurn = [...messages].reverse().find((m) => m.role === 'assistant')
  const priorAssistantText = (priorAssistantTurn?.content || '').toLowerCase()
  const askedForEmail = priorAssistantText.includes('email')
  const askedForName =
    priorAssistantText.includes('name') &&
    (priorAssistantText.includes('your name') ||
      priorAssistantText.includes('what is') ||
      priorAssistantText.includes("what's") ||
      priorAssistantText.includes('may i have'))

  if (!effectiveContactName || effectiveContactName === 'there') {
    const nameMatch = userText.match(/(?:my name is|i am|i'm|this is)\s+([a-zA-Z\s'-]{2,40})/i)
    let nameVal = nameMatch ? nameMatch[1].trim() : null
    if (
      !nameVal &&
      askedForName &&
      userText.length >= 2 &&
      userText.length <= 40 &&
      !userText.includes('\n') &&
      /^[a-zA-Z\s'-]+$/.test(userText)
    ) {
      nameVal = userText.trim()
    }
    if (nameVal) {
      state.informationCollected['name'] = nameVal
      effectiveContactName = nameVal
      void Promise.resolve(
        db
          .from('contacts')
          .update({ name: nameVal, updated_at: new Date().toISOString() })
          .eq('id', contactId)
      ).catch((err: unknown) => console.warn('[flow-manager] failed to update contact name:', err))
    }
  }

  // 2. Immediate Intent Gate: Opt-Out (STOP, UNSUBSCRIBE, etc.)
  if (OPT_OUT_REGEX.test(lowerUserText)) {
    state.currentStage = 'OPT_OUT'
    state.status = 'paused'

    await db
      .from('conversations')
      .update({
        ai_autoreply_disabled: true,
        ai_handoff_summary: 'Customer opted out of automated messaging.',
      })
      .eq('id', conversationId)

    await persistFlowState(db, qualificationRecord.id, state, 'HUMAN_HANDOFF')

    void dispatchAiOutcomeEvent(db, {
      type: 'customer_opted_out',
      accountId,
      contactId,
      conversationId,
    }).catch((err) => console.warn('[flow-manager] dispatch customer_opted_out error:', err))

    const reply =
      'You have been unsubscribed and our automated messages have been paused. You will not receive further automated messages from us. If you ever wish to reconnect with us, simply message us anytime. Have a great day!'

    return {
      text: reply,
      handoff: true,
      state,
      leadSummary: buildLeadSummary(state, profile),
    }
  }

  // 3. Immediate Intent Gate: Human Handoff Request
  if (HUMAN_REQUEST_REGEX.test(lowerUserText)) {
    state.currentStage = 'HUMAN_HANDOFF'
    state.status = 'handed_off'

    await persistFlowState(db, qualificationRecord.id, state, 'HUMAN_HANDOFF')

    void dispatchAiOutcomeEvent(db, {
      type: 'conversation_handed_off',
      accountId,
      contactId,
      conversationId,
      data: { handoffReason: 'Customer requested human assistance' },
    }).catch((err) => console.warn('[flow-manager] dispatch conversation_handed_off error:', err))

    const handoffText = renderTemplate(
      getEffectiveTemplate(templates, 'human_handoff'),
      {
        business_name: profile.businessName,
        customer_name: contactName || 'there',
      },
    )

    return {
      text: `${handoffText}\n\n${HANDOFF_SENTINEL}`,
      handoff: true,
      state,
      leadSummary: buildLeadSummary(state, profile),
    }
  }

  // 4. Parse dates, times, and meeting intent
  const nlpResult = parseNaturalDateTime(userText, now, tz)

  // Handle meeting cancellation
  if (nlpResult.isCancellation && (state.currentStage === 'MEETING_BOOKED' || qualificationRecord.meeting_id)) {
    if (qualificationRecord.meeting_id) {
      await cancelMeeting(db, {
        meetingId: qualificationRecord.meeting_id,
        accountId,
        reason: 'Cancelled by customer via WhatsApp',
      })
    }
    state.currentStage = 'MEETING_CANCELLED'
    await persistFlowState(db, qualificationRecord.id, state, 'MEETING_CANCELLED')

    return {
      text: `No problem at all! I have cancelled your scheduled meeting with ${profile.businessName}. Whenever you would like to reconnect, simply message us here. Have a great day!`,
      handoff: false,
      state,
      leadSummary: buildLeadSummary(state, profile),
    }
  }

  // Handle meeting reschedule
  if (nlpResult.isReschedule && qualificationRecord.meeting_id) {
    const slots = await getAvailableSlots(db, accountId, { limit: 3 })
    const formattedSlots = formatSlotsForWhatsApp(slots)
    state.currentStage = 'SLOT_SELECTION'

    await persistFlowState(db, qualificationRecord.id, state, 'SLOT_SELECTION', slots)

    return {
      text: `I'd be happy to reschedule! Here are the next available slots:\n\n${formattedSlots}\n\nWhich slot works best for you? (You can also propose another date and time).`,
      handoff: false,
      state,
      leadSummary: buildLeadSummary(state, profile),
    }
  }

  // 5. Active Scheduling Sub-flow (SLOT_SELECTION or CONFIRM_BOOK)
  const isSchedulingStage =
    state.currentStage === 'SLOT_SELECTION' ||
    state.currentStage === 'CONFIRM_BOOK' ||
    (nlpResult.selectedOptionIndex !== undefined &&
      qualificationRecord.proposed_slots &&
      qualificationRecord.proposed_slots.length > 0)

  if (isSchedulingStage) {
    // 5A. Prospect chose one of proposed numbered slots (e.g. "1", "2")
    if (
      nlpResult.selectedOptionIndex !== undefined &&
      qualificationRecord.proposed_slots &&
      qualificationRecord.proposed_slots[nlpResult.selectedOptionIndex]
    ) {
      const chosenSlot = qualificationRecord.proposed_slots[nlpResult.selectedOptionIndex]
      const isFree = await isSlotAvailable(db, accountId, chosenSlot.startTime, chosenSlot.endTime)

      if (isFree) {
        return await executeCalendarBooking({
          db,
          accountId,
          contactId,
          conversationId,
          qualificationId: qualificationRecord.id,
          state,
          chosenSlot,
          profile,
          templates,
          contactName,
        })
      } else {
        const altSlots = await getAvailableSlots(db, accountId, { limit: 3 })
        const formatted = formatSlotsForWhatsApp(altSlots)
        await persistFlowState(db, qualificationRecord.id, state, 'SLOT_SELECTION', altSlots)
        return {
          text: `That slot was just booked! Here are other open slots:\n\n${formatted}\n\nWhich one works for you?`,
          handoff: false,
          state,
          leadSummary: buildLeadSummary(state, profile),
        }
      }
    }

    // 5B. Prospect confirmed offered slot in CONFIRM_BOOK
    if (
      state.currentStage === 'CONFIRM_BOOK' &&
      (nlpResult.isAffirmative || isAffirmativeResponse(userText)) &&
      state.pendingBooking.selectedSlot
    ) {
      const slotStart = new Date(state.pendingBooking.selectedSlot)
      const slotEnd = new Date(slotStart.getTime() + (settings.meeting_duration_minutes || 15) * 60 * 1000)
      const chosenSlot = {
        startTime: slotStart.toISOString(),
        endTime: slotEnd.toISOString(),
        formattedDate: slotStart.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz }),
        formattedTime: slotStart.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }),
        timezone: tz,
      }

      const isFree = await isSlotAvailable(db, accountId, chosenSlot.startTime, chosenSlot.endTime)
      if (isFree) {
        return await executeCalendarBooking({
          db,
          accountId,
          contactId,
          conversationId,
          qualificationId: qualificationRecord.id,
          state,
          chosenSlot,
          profile,
          templates,
          contactName,
        })
      }
    }

    // 5C. Prospect specified both Date and Time
    if (nlpResult.hasExplicitDate && nlpResult.hasExplicitTime && nlpResult.date) {
      const start = nlpResult.date
      const end = new Date(start.getTime() + (settings.meeting_duration_minutes || 15) * 60 * 1000)
      const candidateSlot = {
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        formattedDate: start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz }),
        formattedTime: start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }),
        timezone: tz,
      }

      const isFree = await isSlotAvailable(db, accountId, candidateSlot.startTime, candidateSlot.endTime)
      if (isFree) {
        state.currentStage = 'CONFIRM_BOOK'
        state.pendingBooking.selectedSlot = candidateSlot.startTime
        state.pendingBooking.preferredDate = nlpResult.dateStr || null
        state.pendingBooking.preferredTime = nlpResult.timeStr || null

        await persistFlowState(db, qualificationRecord.id, state, 'SLOT_SELECTION', [candidateSlot])

        return {
          text: `Good news! ${candidateSlot.formattedDate} at ${candidateSlot.formattedTime} (${tz}) is available for a ${settings.meeting_duration_minutes || 15}-minute consultation. 🙌\n\nShall I go ahead and book that for you?`,
          handoff: false,
          state,
          leadSummary: buildLeadSummary(state, profile),
        }
      } else {
        const altSlots = await getAvailableSlots(db, accountId, { limit: 3 })
        const formatted = formatSlotsForWhatsApp(altSlots)
        await persistFlowState(db, qualificationRecord.id, state, 'SLOT_SELECTION', altSlots)

        return {
          text: `That particular time is already booked. Here are the closest available slots:\n\n${formatted}\n\nWhich slot works best for you?`,
          handoff: false,
          state,
          leadSummary: buildLeadSummary(state, profile),
        }
      }
    }

    // 5D. Prospect declined slot in scheduling
    if (nlpResult.isNegative || isNegativeResponse(userText)) {
      state.currentStage = 'STAGE_B_ACKNOWLEDGE_SERVICE'
      await persistFlowState(db, qualificationRecord.id, state, 'LEAD_QUALIFIED')
      return {
        text: `No worries at all! Would you prefer to explore our pricing options instead, or suggest another day that suits you better?`,
        handoff: false,
        state,
        leadSummary: buildLeadSummary(state, profile),
      }
    }
  }

  // 6. Service Identification & Catalog Matching
  const matchedService = matchServiceFromCatalog(userText, profile.services)
  if (matchedService) {
    if (!state.selectedService || state.selectedService !== matchedService.id) {
      state.selectedService = matchedService.id
      state.selectedServiceName = matchedService.name
      if (!state.servicesIdentified.includes(matchedService.name)) {
        state.servicesIdentified.push(matchedService.name)
      }
      state.benefitsExplained = false
      state.discoveryQuestionsAsked = 0
      state.pricingRequested = false
      state.consultationRequested = false
      state.pricingDiscussed = false
      state.pendingBooking = {}
      state.currentStage = 'STAGE_B_ACKNOWLEDGE_SERVICE'
    }
  }

  // If customer attempted to select a service or tapped a button, but it could not be resolved against tenant catalog:
  const isServiceSelectionAttempt =
    priorAssistantText.includes('which of our core services') ||
    priorAssistantText.includes('which service are you interested in') ||
    priorAssistantText.includes('select an option') ||
    lowerUserText.includes('service') ||
    lowerUserText.startsWith('btn_')

  if (isServiceSelectionAttempt && !matchedService && !state.selectedService) {
    console.info('[flow-manager] service resolution unresolvable against catalog:', {
      accountId,
      inputLength: userText.length,
      availableServicesCount: profile.services.length,
    })
    const serviceList = profile.services.map((s, i) => `${i + 1}. ${s.name}`).join('\n')
    return {
      text: `Thanks for reaching out! To make sure I get you the right information, which of our services are you interested in?\n\n${serviceList}\n\nOr feel free to tell me what you're looking to achieve, or ask about pricing!`,
      handoff: false,
      state,
      leadSummary: buildLeadSummary(state, profile),
    }
  }

  // 7. Intent Recognition: Pricing vs Consultation
  const asksPricing = PRICING_INTENT_REGEX.test(userText)
  const asksConsultation =
    CONSULTATION_INTENT_REGEX.test(userText) ||
    (state.optionsOffered.includes('2') && (lowerUserText === '2' || lowerUserText.includes('consultation')))

  if (asksPricing) {
    state.pricingRequested = true
    state.selectedOption = '1. Explore pricing'
  }

  if (asksConsultation) {
    state.consultationRequested = true
    state.selectedOption = '2. Book a consultation'
  }

  // 8. Deterministic Flow State Transitions
  // Rule: If customer has already requested consultation, move to Stage D immediately!
  if (state.consultationRequested && !state.pendingBooking.selectedSlot && state.currentStage !== 'MEETING_BOOKED') {
    state.currentStage = 'SLOT_SELECTION'
    const slots = await getAvailableSlots(db, accountId, { limit: 3 })
    const formattedSlots = formatSlotsForWhatsApp(slots)
    await persistFlowState(db, qualificationRecord.id, state, 'SLOT_SELECTION', slots)

    const detailPrompt = renderTemplate(
      getEffectiveTemplate(templates, 'booking_detail_collection'),
      {
        business_name: profile.businessName,
        customer_name: contactName || 'there',
        service_name: state.selectedServiceName || 'our services',
      },
    )

    const text = slots.length > 0
      ? `We'd love to schedule a consultation with you! Here are our next available slots:\n\n${formattedSlots}\n\nWhich slot works best, or let us know a day/time that suits you!`
      : detailPrompt

    return {
      text,
      handoff: false,
      state,
      leadSummary: buildLeadSummary(state, profile),
    }
  }

  // Rule: If customer has requested pricing, move to Stage C immediately!
  if (state.pricingRequested && !state.pricingDiscussed) {
    state.currentStage = 'STAGE_C_PRICING'
    state.pricingDiscussed = true

    const pricingInfo = formatPricingPackages(profile.pricingPackages, state.selectedService)
    const pricingReply = renderTemplate(
      getEffectiveTemplate(templates, 'pricing_response'),
      {
        business_name: profile.businessName,
        customer_name: contactName || 'there',
        service_name: state.selectedServiceName || 'our solutions',
        pricing_info: pricingInfo,
      },
    )

    await persistFlowState(db, qualificationRecord.id, state, 'LEAD_QUALIFIED')

    void dispatchAiOutcomeEvent(db, {
      type: 'lead_qualified',
      accountId,
      contactId,
      conversationId,
      data: {
        serviceName: state.selectedServiceName ?? undefined,
        leadSummary: buildLeadSummary(state, profile),
      },
    }).catch((err) => console.warn('[flow-manager] dispatch lead_qualified error:', err))

    return {
      text: pricingReply,
      handoff: false,
      state,
      leadSummary: buildLeadSummary(state, profile),
    }
  }

  // Rule: If customer just identified a service (or service is selected and benefits not yet explained):
  // STAGE B: Acknowledge Selected Service + Grounded Capabilities/Benefits + Consultative Goal Discovery Question
  if (state.selectedService && !state.benefitsExplained && state.currentStage !== 'MEETING_BOOKED') {
    state.currentStage = 'STAGE_B_ACKNOWLEDGE_SERVICE'
    state.benefitsExplained = true
    state.optionsOffered = ['1. Explore pricing', '2. Book a consultation']

    const serviceObj = profile.services.find((s) => s.id === state.selectedService)
    const serviceName = serviceObj?.name || state.selectedServiceName || 'our services'

    let reply: string
    if (
      templates.service_acknowledgement &&
      templates.service_acknowledgement !== DEFAULT_AI_MESSAGE_TEMPLATES.service_acknowledgement
    ) {
      const benefitText =
        serviceObj && serviceObj.benefits && serviceObj.benefits.length > 0
          ? serviceObj.benefits.join(' and ')
          : 'save time, streamline your processes, and achieve consistent results'
      reply = renderTemplate(
        getEffectiveTemplate(templates, 'service_acknowledgement'),
        {
          business_name: profile.businessName,
          customer_name: contactName || 'there',
          service_name: serviceName,
          service_benefits: benefitText,
        },
      )
    } else {
      const desc = serviceObj?.description
        ? ` We help businesses ${serviceObj.description.toLowerCase().replace(/^(we help |we provide |tailored to )/i, '')}.`
        : serviceObj?.benefits && serviceObj.benefits.length > 0
          ? ` We help you ${serviceObj.benefits.join(' and ')}.`
          : ''
      const goalVerb = /automation|bot|ai/i.test(serviceName)
        ? 'automate'
        : /web|develop|design|app/i.test(serviceName)
          ? 'build'
          : /marketing|seo|growth|lead/i.test(serviceName)
            ? 'grow'
            : 'achieve'

      reply = `Great choice! Thanks for your interest in our ${serviceName} services.${desc}\n\nWhat are you looking to ${goalVerb} in your business right now?\n1. Explore pricing\n2. Book a consultation`
    }

    await persistFlowState(db, qualificationRecord.id, state, 'REQUIREMENT_DISCOVERY')

    return {
      text: reply,
      handoff: false,
      state,
      leadSummary: buildLeadSummary(state, profile),
    }
  }

  // 8B. Work email acknowledgement & transition to service presentation
  const isAnsweringEmail = Boolean(emailMatch || (askedForEmail && userText.includes('@')))
  if (isAnsweringEmail && !state.selectedService) {
    state.currentStage = 'STAGE_A_UNDERSTAND'
    const serviceList = profile.services.map((s, i) => `${i + 1}. ${s.name}`).join('\n')
    const emailDisplay = extractedEmail || (emailMatch ? emailMatch[0].trim() : userText.trim())
    const greeting = effectiveContactName ? `Thanks ${effectiveContactName}!` : 'Thank you!'
    const text = `${greeting} I've noted your work email (${emailDisplay}). Which of our core services would make the biggest difference for your business right now?\n\n${serviceList}\n\nOr let me know if you would like to explore pricing or schedule a call!`

    await persistFlowState(db, qualificationRecord.id, state, 'REQUIREMENT_DISCOVERY')

    return {
      text,
      handoff: false,
      state,
      leadSummary: buildLeadSummary(state, profile),
    }
  }

  // 9. Natural Language Discovery within Stage A / Follow-up after Service Selection
  // Limit discovery questions to maxDiscoveryQuestions (default 2)
  if (state.discoveryQuestionsAsked >= (flowConfig.maxDiscoveryQuestions || 2)) {
    if (!state.selectedService) {
      // Discovery limit reached and no service selected yet — present services menu
      const serviceList = profile.services.map((s, i) => `${i + 1}. ${s.name}`).join('\n')
      const greeting = effectiveContactName ? `Thanks for sharing those details, ${effectiveContactName}!` : 'Thanks for sharing those details!'
      const text = `${greeting} We can certainly help. Which of our core services would make the biggest difference for you right now?\n\n${serviceList}\n\nOr let me know if you would like to explore pricing or schedule a call!`

      state.currentStage = 'STAGE_A_UNDERSTAND'
      await persistFlowState(db, qualificationRecord.id, state, 'REQUIREMENT_DISCOVERY')

      return {
        text,
        handoff: false,
        state,
        leadSummary: buildLeadSummary(state, profile),
      }
    } else {
      // Service is already selected and discovery limit reached: wrap up discovery and present next steps (never repeat the 6-service menu!)
      const greeting = effectiveContactName ? `Thank you, ${effectiveContactName}!` : 'Thank you!'
      const text = `${greeting} I have a good understanding of your requirements for ${state.selectedServiceName}. Would you like to explore our pricing packages or book a consultation call with our team?`
      state.optionsOffered = ['1. Explore pricing', '2. Book a consultation']
      state.currentStage = 'STAGE_B_ACKNOWLEDGE_SERVICE'
      await persistFlowState(db, qualificationRecord.id, state, 'LEAD_QUALIFIED')
      return {
        text,
        handoff: false,
        state,
        leadSummary: buildLeadSummary(state, profile),
      }
    }
  }

  // Record user requirement if provided
  if (userText) {
    const prevReq = state.informationCollected['requirements']
    state.informationCollected['requirements'] = prevReq
      ? `${prevReq}; ${userText}`
      : userText
  }

  // Ask focused discovery question via LLM within Stage A boundaries
  const systemPrompt = buildFlowSystemPrompt({
    profile,
    flowConfig,
    state,
    contactName: effectiveContactName,
    basePrompt: config.systemPrompt,
  })

  const gen = await generateReply({
    config,
    systemPrompt,
    messages,
  })
  const generatedText = gen.text
  let genHandoff = gen.handoff

  if (generatedText.includes(HANDOFF_SENTINEL)) {
    genHandoff = true
  }

  state.discoveryQuestionsAsked += 1
  state.lastQuestionAsked = generatedText

  await persistFlowState(db, qualificationRecord.id, state, 'REQUIREMENT_DISCOVERY')

  return {
    text: generatedText.replace(HANDOFF_SENTINEL, '').trim(),
    handoff: genHandoff,
    state,
    leadSummary: buildLeadSummary(state, profile),
  }
}

/**
 * Execute real calendar booking and verify persistence.
 */
async function executeCalendarBooking(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
  conversationId: string
  qualificationId: string
  state: DeterministicFlowState
  chosenSlot: {
    startTime: string
    endTime: string
    formattedDate: string
    formattedTime: string
    timezone: string
  }
  profile: AiBusinessProfile
  templates: AiMessageTemplates
  contactName?: string | null
}): Promise<FlowManagerResult> {
  const {
    db,
    accountId,
    contactId,
    conversationId,
    qualificationId,
    state,
    chosenSlot,
    profile,
    templates,
    contactName,
  } = args

  const idempotencyKey = `flow_bcast_${conversationId}_${new Date(chosenSlot.startTime).getTime()}`
  const leadSummaryText = buildLeadSummary(state, profile)

  const bookingRes = await bookMeeting(db, {
    accountId,
    contactId,
    conversationId,
    title: `${profile.businessName} Consultation: ${contactName || 'Lead'} (${state.selectedServiceName || 'Services'})`,
    description: `Customer: ${contactName || 'WhatsApp Lead'}\nService: ${state.selectedServiceName || 'General'}\nSummary: ${leadSummaryText}`,
    serviceRequested: state.selectedServiceName || 'Consultation',
    startTime: chosenSlot.startTime,
    endTime: chosenSlot.endTime,
    timezone: chosenSlot.timezone,
    bookingSource: 'whatsapp_ai',
    leadSummary: leadSummaryText,
    idempotencyKey,
  })

  if (bookingRes.success && bookingRes.meeting_id) {
    state.currentStage = 'MEETING_BOOKED'
    state.status = 'completed'
    state.pendingBooking.selectedSlot = chosenSlot.startTime

    await persistFlowState(db, qualificationId, state, 'MEETING_BOOKED', undefined, bookingRes.meeting_id)

    void dispatchAiOutcomeEvent(db, {
      type: 'meeting_booked',
      accountId,
      contactId,
      conversationId,
      idempotencyKey,
      data: {
        meetingId: bookingRes.meeting_id,
        serviceName: state.selectedServiceName ?? undefined,
        leadSummary: leadSummaryText,
        contactName: contactName || undefined,
        budget: state.informationCollected['budget'] || state.informationCollected['price_expectation'],
      },
    }).catch((err) => console.warn('[flow-manager] dispatch meeting_booked error:', err))

    const confirmationText = renderTemplate(
      getEffectiveTemplate(templates, 'booking_confirmation'),
      {
        business_name: profile.businessName,
        customer_name: contactName || 'there',
        service_name: state.selectedServiceName || 'our services',
        meeting_date: chosenSlot.formattedDate,
        meeting_time: chosenSlot.formattedTime,
        meeting_link: bookingRes.meeting_link || profile.meetingRules?.defaultMeetingLink || 'will be sent prior to the call',
      },
    )

    return {
      text: confirmationText,
      handoff: false,
      state,
      bookedMeetingId: bookingRes.meeting_id,
      leadSummary: leadSummaryText,
    }
  }

  // Booking failed or slot raced away
  const altSlots = await getAvailableSlots(db, accountId, { limit: 3 })
  const formatted = formatSlotsForWhatsApp(altSlots)
  state.currentStage = 'SLOT_SELECTION'

  await persistFlowState(db, qualificationId, state, 'SLOT_SELECTION', altSlots)

  return {
    text: `I was unable to secure that exact slot. Here are the closest available slots with our team:\n\n${formatted}\n\nWhich slot works for you?`,
    handoff: false,
    state,
    leadSummary: leadSummaryText,
  }
}

export interface LeadQualificationRecord {
  id: string
  account_id: string
  contact_id: string
  conversation_id: string
  state: string
  qualification_notes?: string | null
  flow_state?: DeterministicFlowState | null
  requested_service?: string | null
  proposed_slots?: TimeSlot[] | null
  meeting_id?: string | null
  selected_slot?: unknown
  [key: string]: unknown
}

/**
 * Persist deterministic state with backward-compatible fallback to qualification_notes.
 */
export async function persistFlowState(
  db: SupabaseClient,
  qualificationId: string,
  state: DeterministicFlowState,
  dbState: string,
  proposedSlots?: TimeSlot[],
  meetingId?: string,
): Promise<void> {
  const summary = `${state.selectedServiceName ? `Service: ${state.selectedServiceName} | ` : ''}Stage: ${state.currentStage}`
  const notes = `${summary}\n---\n${JSON.stringify(state)}`

  const payload: Record<string, unknown> = {
    state: dbState,
    requested_service: state.selectedServiceName || null,
    qualification_notes: notes,
    flow_state: state,
    last_interaction_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  if (proposedSlots) {
    payload.proposed_slots = proposedSlots
  }
  if (meetingId) {
    payload.meeting_id = meetingId
  }
  if (state.pendingBooking.selectedSlot) {
    payload.selected_slot = state.pendingBooking.selectedSlot
  }

  // Attempt update with flow_state column
  const { error } = await db
    .from('ai_lead_qualifications')
    .update(payload)
    .eq('id', qualificationId)

  // If column flow_state doesn't exist yet on DB, retry without it (backward compatibility)
  if (error && (error.code === '42703' || error.message?.includes('flow_state'))) {
    delete payload.flow_state
    await db
      .from('ai_lead_qualifications')
      .update(payload)
      .eq('id', qualificationId)
  }
}

/**
 * Load or create an ai_lead_qualifications row.
 */
export async function loadOrCreateQualification(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  conversationId: string,
): Promise<LeadQualificationRecord> {
  const { data } = await db
    .from('ai_lead_qualifications')
    .select('*')
    .eq('conversation_id', conversationId)
    .maybeSingle()

  if (data) return data as LeadQualificationRecord

  const { data: created, error } = await db
    .from('ai_lead_qualifications')
    .insert({
      account_id: accountId,
      contact_id: contactId,
      conversation_id: conversationId,
      state: 'NEW_LEAD',
    })
    .select()
    .single()

  if (error || !created) {
    return {
      id: 'temp-' + conversationId,
      account_id: accountId,
      contact_id: contactId,
      conversation_id: conversationId,
      state: 'NEW_LEAD',
      qualification_notes: null,
      proposed_slots: [],
    }
  }

  return created as LeadQualificationRecord
}

/**
 * Deserialize deterministic flow state from database row.
 */
export function deserializeFlowState(
  row: LeadQualificationRecord,
  defaultPreset: FlowPresetType = 'service_to_conversion',
): DeterministicFlowState {
  if (row.flow_state && typeof row.flow_state === 'object' && row.flow_state.currentStage) {
    return row.flow_state
  }

  // Fallback to parsing from qualification_notes
  if (row.qualification_notes && typeof row.qualification_notes === 'string' && row.qualification_notes.includes('---')) {
    try {
      const jsonPart = row.qualification_notes.substring(row.qualification_notes.indexOf('---') + 3).trim()
      const parsed = JSON.parse(jsonPart)
      if (parsed && typeof parsed === 'object' && 'currentStage' in parsed) {
        return parsed as DeterministicFlowState
      }
    } catch {
      // ignore
    }
  }

  return {
    currentFlow: defaultPreset,
    currentStage: 'STAGE_A_UNDERSTAND',
    servicesIdentified: row.requested_service ? [row.requested_service] : [],
    selectedService: null,
    selectedServiceName: row.requested_service || null,
    informationCollected: {},
    lastQuestionAsked: null,
    optionsOffered: [],
    selectedOption: null,
    discoveryQuestionsAsked: 0,
    pricingRequested: false,
    consultationRequested: false,
    benefitsExplained: false,
    pricingDiscussed: false,
    pendingBooking: {},
    status: 'in_progress',
  }
}

/**
 * Build concise summary of lead for human agent & CRM.
 */
export function buildLeadSummary(
  state: DeterministicFlowState,
  profile: AiBusinessProfile,
): string {
  const parts: string[] = []
  parts.push(`Business: ${profile.businessName}`)
  if (state.selectedServiceName) parts.push(`Service: ${state.selectedServiceName}`)
  if (state.selectedOption) parts.push(`Choice: ${state.selectedOption}`)
  parts.push(`Stage: ${state.currentStage}`)
  return parts.join(' | ')
}

/**
 * Build rich system prompt for Stage A discovery.
 */
function buildFlowSystemPrompt(args: {
  profile: AiBusinessProfile
  flowConfig: AiConversationFlowConfig
  state: DeterministicFlowState
  contactName?: string | null
  basePrompt?: string | null
}): string {
  const { profile, flowConfig, state, contactName, basePrompt } = args

  const parts = [
    `You are the official conversational sales & solutions advisor for ${profile.businessName}.`,
    `Business Description: ${profile.businessDescription}`,
    `Industry: ${profile.industry} | Target Customers: ${profile.targetCustomers}`,
    `Tone: ${profile.tone} | Language: ${profile.preferredLanguage} | Length: ${profile.responseLength}`,
    `Prospect Name: ${contactName || 'Valued Prospect'}`,
    `Current Stage: ${state.currentStage} | Active Preset: ${flowConfig.preset}`,
    '',
    '## CORE CONVERSATION QUALITY RULES (STRICT):',
    '1. ONE QUESTION PER MESSAGE: Never ask more than one question in a single reply.',
    '2. NEVER ASK FOR INFORMATION ALREADY PROVIDED: If the prospect already shared what they do, their challenge, or what service they want, do not ask them again!',
    '3. ACKNOWLEDGE BEFORE ASKING: Genuinely acknowledge what they just said before asking your question.',
    '4. DO NOT REPEAT QUESTIONS: Never repeat a question you already asked.',
    '5. DO NOT INVENT PRICES OR BOOKINGS: Only discuss verified pricing packages or offer consultations. Never make up discounts or false availability.',
    '6. CONCISE: WhatsApp messages must be short (2 to 4 sentences).',
    '',
    `## SERVICES OFFERED:`,
    ...profile.services.map((s) => `- ${s.name}: ${s.description}`),
  ]

  if (state.selectedServiceName) {
    const serviceObj = profile.services.find(
      (s) =>
        s.name.toLowerCase() === state.selectedServiceName!.toLowerCase() ||
        s.id === state.selectedService,
    )
    parts.push(
      '',
      `## CURRENT SELECTED SERVICE CONTEXT:`,
      `- The customer has selected: "${state.selectedServiceName}".`,
      serviceObj?.description ? `- Configured Service Scope: ${serviceObj.description}` : '',
      serviceObj?.benefits?.length ? `- Configured Benefits: ${serviceObj.benefits.join(', ')}` : '',
      state.informationCollected['requirements']
        ? `- Customer stated requirements: "${state.informationCollected['requirements']}".`
        : '',
      `- CRITICAL RULES:`,
      `  1. DO NOT ask them to choose or list services again. DO NOT output a catalog or menu of all services.`,
      `  2. DO NOT replace or substitute "${state.selectedServiceName}" with any other service or general consultation.`,
      `  3. Acknowledge their requirement in the context of ${state.selectedServiceName}, explain relevant configured capabilities and benefits, and ask exactly ONE relevant follow-up question (such as expected message volume, peak traffic, current systems/tools, or specific business use case) to understand their setup.`,
      `  4. If they ask about pricing or quote, explain that pricing depends on scope and workflow requirements, reference any configured pricing rules, and offer a consultation.`,
    )
  }

  if (profile.customInstructions) {
    parts.push(`\n## CUSTOM INSTRUCTIONS:\n${profile.customInstructions}`)
  }

  if (profile.prohibitedClaims && profile.prohibitedClaims.length > 0) {
    parts.push(`\n## PROHIBITED CLAIMS:\n${profile.prohibitedClaims.map((c) => `- ${c}`).join('\n')}`)
  }

  if (basePrompt && basePrompt.trim()) {
    parts.push(`\n## ADDITIONAL DIRECTIVES:\n${basePrompt}`)
  }

  return parts.join('\n')
}
