// ============================================================
// Shared types for the AI reply assistant (bring-your-own-key).
//
// One small provider-agnostic surface so the inbox draft route and the
// inbound auto-reply bot both talk to `generateReply` without caring
// whether the account is on OpenAI or Anthropic.
// ============================================================

export type AiProvider = 'openai' | 'anthropic' | 'openai_compatible'

export interface ServiceItem {
  id: string
  name: string
  description: string
  benefits: string[]
  keywords?: string[]
}

export interface PricingPackage {
  id: string
  name: string
  price: string
  billingPeriod?: string
  description?: string
  features?: string[]
  serviceId?: string
}

export interface PricingRule {
  id: string
  title: string
  condition?: string
  rule: string
}

export interface FaqItem {
  question: string
  answer: string
}

export interface AiBusinessProfile {
  businessName: string
  businessDescription: string
  industry: string
  targetCustomers: string
  services: ServiceItem[]
  pricingPackages: PricingPackage[]
  pricingRules: PricingRule[]
  faqs: FaqItem[]
  tone: 'professional' | 'consultative' | 'friendly' | 'casual' | 'formal'
  personality?: string
  preferredLanguage: string
  responseLength: 'concise' | 'detailed' | 'balanced'
  primaryConversionGoal: 'schedule_consultation' | 'explore_pricing' | 'lead_qualification' | 'direct_booking'
  meetingRules?: {
    durationMinutes?: number
    defaultMeetingLink?: string
    noticeHours?: number
    allowReschedule?: boolean
  }
  handoffPreferences?: {
    escalationContact?: string
    notifyChannel?: string
    autoHandoffOnFrustration?: boolean
  }
  customInstructions?: string
  prohibitedClaims?: string[]
}

export type FlowPresetType =
  | 'service_to_conversion'
  | 'lead_qualification'
  | 'pricing_inquiry'
  | 'appointment_booking'
  | 'support_faq'
  | 'human_handoff'
  | 'custom'

/**
 * Account-level conversational ownership mode:
 * - `ai_agent`: AI Agent owns natural dialogue, greetings, and qualification; background automations run non-conflicting actions.
 * - `flow_first`: Visual Flow owns structured conversation; AI is invoked via explicit handoff or fallback.
 * - `automation_first`: Conversational automations own dialogue.
 */
export type ConversationMode = 'ai_agent' | 'flow_first' | 'automation_first'

export interface AiConversationFlowConfig {
  preset: FlowPresetType
  conversationMode?: ConversationMode
  conversation_mode?: ConversationMode
  maxDiscoveryQuestions: number
  requireDiscoveryBeforePricing: boolean
  offerConsultationAfterPricing: boolean
  acknowledgementStyle: 'compliment_and_benefit' | 'direct_benefit' | 'concise'
  twoOptionChoice: boolean
  customSteps?: Array<{
    id: string
    name: string
    objective: string
    promptGuidance?: string
  }>
}

export interface AiMessageTemplates {
  welcome?: string
  service_acknowledgement?: string
  service_benefits?: string
  pricing_response?: string
  pricing_clarification?: string
  consultation_invitation?: string
  booking_detail_collection?: string
  booking_confirmation?: string
  follow_up?: string
  human_handoff?: string
  fallback?: string
}

export type FlowStage =
  | 'STAGE_A_UNDERSTAND'
  | 'STAGE_B_ACKNOWLEDGE_SERVICE'
  | 'STAGE_C_PRICING'
  | 'STAGE_D_CONSULTATION'
  | 'STAGE_E_COMPLETED'
  | 'SLOT_SELECTION'
  | 'CONFIRM_BOOK'
  | 'MEETING_BOOKED'
  | 'MEETING_CANCELLED'
  | 'HUMAN_HANDOFF'
  | 'OPT_OUT'

export interface DeterministicFlowState {
  currentFlow: FlowPresetType
  currentStage: FlowStage
  servicesIdentified: string[]
  selectedService: string | null
  selectedServiceName?: string | null
  informationCollected: Record<string, string>
  lastQuestionAsked: string | null
  optionsOffered: string[]
  selectedOption: string | null
  discoveryQuestionsAsked: number
  pricingRequested: boolean
  consultationRequested: boolean
  benefitsExplained: boolean
  pricingDiscussed: boolean
  pendingBooking: {
    preferredDate?: string | null
    preferredTime?: string | null
    selectedSlot?: string | null
    timezone?: string
  }
  status: 'in_progress' | 'completed' | 'paused' | 'handed_off'
}

/**
 * Account AI setup, decrypted and ready to use. Produced by
 * `loadAiConfig` — `apiKey` is the plaintext BYO provider key
 * (stored AES-256-GCM-encrypted at rest).
 */
export interface AiConfig {
  provider: AiProvider
  model: string
  /** Base URL for OpenAI-compatible providers; null for native providers. */
  baseUrl: string | null
  apiKey: string
  systemPrompt: string | null
  isActive: boolean
  autoReplyEnabled: boolean
  autoReplyMaxPerConversation: number
  /** Where auto-reply hands a conversation off when the model bails: an
   *  agent's `auth.users.id`, or null to leave it unassigned (drop into
   *  the shared queue). */
  handoffAgentId: string | null
  /** Optional OpenAI-compatible key for embeddings. When set, the
   *  knowledge base is embedded and semantic retrieval turns on; when
   *  null, retrieval falls back to lexical full-text search. */
  embeddingsApiKey: string | null
  /** Tenant-specific business profile & catalog */
  businessProfile?: AiBusinessProfile | null
  /** Tenant-specific conversation flow configuration */
  conversationFlow?: AiConversationFlowConfig | null
  /** Tenant-specific message templates */
  messageTemplates?: AiMessageTemplates | null
  /** Account conversation mode */
  conversationMode?: ConversationMode
}

/** A single conversation turn in the shape both providers accept. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Token counts for one provider call, normalized across OpenAI
 * (`prompt`/`completion`) and Anthropic (`input`/`output`). Null when
 * the provider didn't return usage. Logged to `ai_usage_log`.
 */
export interface AiUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** Raw text + usage a provider adapter returns before handoff parsing. */
export interface ProviderResult {
  text: string
  usage: AiUsage | null
}

/** Outcome of a generation call. */
export interface GenerateResult {
  /** The reply text, with any handoff sentinel stripped. */
  text: string
  /** True when the model asked to hand off to a human (auto-reply mode). */
  handoff: boolean
  /** Provider token usage for this call, or null when unavailable. */
  usage: AiUsage | null
}

/**
 * Typed error for every AI failure mode. `status` maps cleanly to an
 * HTTP response in the draft route; `code` lets the UI/tests branch
 * (invalid_key vs rate_limited vs timeout, etc.).
 */
export class AiError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message)
    this.name = 'AiError'
    this.code = opts.code ?? 'ai_error'
    this.status = opts.status ?? 502
  }
}
