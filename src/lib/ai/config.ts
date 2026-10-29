import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import type {
  AiConfig,
  AiBusinessProfile,
  AiConversationFlowConfig,
  AiMessageTemplates,
  ConversationMode,
} from './types'

interface AiConfigRow {
  provider: 'openai' | 'anthropic' | 'openai_compatible'
  model: string
  base_url: string | null
  api_key: string
  system_prompt: string | null
  is_active: boolean
  auto_reply_enabled: boolean
  auto_reply_max_per_conversation: number
  handoff_agent_id: string | null
  embeddings_api_key: string | null
  business_profile?: AiBusinessProfile | null
  conversation_flow?: AiConversationFlowConfig | null
  message_templates?: AiMessageTemplates | null
}

const CONFIG_COLUMNS =
  'provider, model, base_url, api_key, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, embeddings_api_key'

export async function loadAiConfig(
  db: SupabaseClient,
  accountId: string,
  opts: { requireActive?: boolean; requireDecryptedKey?: boolean } = {},
): Promise<AiConfig | null> {
  const { requireActive = true, requireDecryptedKey = true } = opts

  let data: AiConfigRow | null = null
  let error: { code?: string; message?: string } | null = null

  // Try selecting with extended business_profile and flow columns
  const primaryRes = await db
    .from('ai_configs')
    .select(`${CONFIG_COLUMNS}, business_profile, conversation_flow, message_templates`)
    .eq('account_id', accountId)
    .maybeSingle()

  if (primaryRes.error && (primaryRes.error.code === '42703' || primaryRes.error.code === 'PGRST100' || primaryRes.error.message?.includes('column'))) {
    // Backward-compatible fallback if migration 053 hasn't run yet
    const fallbackRes = await db
      .from('ai_configs')
      .select(CONFIG_COLUMNS)
      .eq('account_id', accountId)
      .maybeSingle()
    data = fallbackRes.data as AiConfigRow | null
    error = fallbackRes.error
  } else {
    data = primaryRes.data as AiConfigRow | null
    error = primaryRes.error
  }

  if (error) throw error
  if (!data) return null

  const row = data
  // The Playground passes requireActive:false so an admin can test the
  // agent before flipping the master switch on.
  if (requireActive && !row.is_active) return null
  // Defensive: the column is NOT NULL, but a partial write / manual DB
  // edit could leave it empty. Treat a missing key as "not configured"
  // rather than letting decrypt() throw on null.
  if (!row.api_key) return null

  // The embeddings key is optional and independent of the chat key —
  // a corrupt/undecryptable one should downgrade to lexical KB, not
  // take down draft/auto-reply, so decrypt failures are swallowed here.
  let embeddingsApiKey: string | null = null
  if (row.embeddings_api_key) {
    try {
      embeddingsApiKey = decrypt(row.embeddings_api_key)
    } catch {
      // Not silent — a rotated/mismatched ENCRYPTION_KEY here means
      // semantic search quietly stops working, so leave a breadcrumb.
      console.error(
        `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; semantic search is disabled until it is re-entered.`,
      )
      embeddingsApiKey = null
    }
  }

  let apiKey: string = ''
  try {
    apiKey = decrypt(row.api_key)
  } catch (err) {
    console.error(
      `[ai config] API key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY or re-enter key in AI Settings:`,
      err instanceof Error ? err.message : err,
    )
    if (requireDecryptedKey) {
      throw err
    }
  }

  let businessProfile = row.business_profile ?? null
  let conversationFlow = row.conversation_flow ?? null
  let messageTemplates = row.message_templates ?? null

  if (!businessProfile || !businessProfile.services || businessProfile.services.length === 0 || !conversationFlow || !messageTemplates) {
    try {
      const { data: acc } = await db
        .from('accounts')
        .select('metadata')
        .eq('id', accountId)
        .maybeSingle()
      const meta = (acc?.metadata as Record<string, unknown>) ?? {}
      if (!businessProfile && meta.ai_business_profile) {
        businessProfile = meta.ai_business_profile as AiBusinessProfile
      }
      if (!conversationFlow && meta.ai_conversation_flow) {
        conversationFlow = meta.ai_conversation_flow as AiConversationFlowConfig
      }
      if (!messageTemplates && meta.ai_message_templates) {
        messageTemplates = meta.ai_message_templates as AiMessageTemplates
      }
    } catch (e) {
      console.warn('[loadAiConfig] accounts.metadata fallback query error:', e)
    }
  }

  const rawFlow = (conversationFlow ?? row.conversation_flow) as (AiConversationFlowConfig & { conversation_mode?: ConversationMode; conversationMode?: ConversationMode }) | null
  const conversationMode: ConversationMode =
    rawFlow?.conversationMode ??
    rawFlow?.conversation_mode ??
    (row.is_active && row.auto_reply_enabled ? 'ai_agent' : 'flow_first')

  return {
    provider: row.provider,
    model: row.model,
    baseUrl: row.base_url,
    apiKey,
    systemPrompt: row.system_prompt,
    isActive: row.is_active,
    autoReplyEnabled: row.auto_reply_enabled,
    autoReplyMaxPerConversation: row.auto_reply_max_per_conversation,
    handoffAgentId: row.handoff_agent_id,
    embeddingsApiKey,
    businessProfile,
    conversationFlow,
    messageTemplates,
    conversationMode,
  }
}

/**
 * Determine the effective conversation mode for an account.
 * Default is 'ai_agent' when AI is configured and auto-reply is active.
 */
export function resolveConversationMode(config: AiConfig | null): ConversationMode {
  if (!config) return 'flow_first'
  if (config.conversationMode) return config.conversationMode
  if (config.conversationFlow?.conversationMode) return config.conversationFlow.conversationMode
  if (config.conversationFlow?.conversation_mode) return config.conversationFlow.conversation_mode
  return config.isActive && config.autoReplyEnabled ? 'ai_agent' : 'flow_first'
}

/**
 * Load + decrypt just the embeddings key, independent of `is_active`.
 * Used by the knowledge-base ingest routes so the KB gets embedded (and
 * semantic search works) whenever an embeddings key is present, even if
 * the assistant's master switch is currently off.
 *
 * Returns `{ key, corrupt }`: `key` is null when there's no key OR it
 * can't be decrypted; `corrupt` distinguishes those cases so callers can
 * warn ("a key is set but unusable") rather than silently indexing
 * lexical-only and reporting success.
 */
export async function loadEmbeddingsKey(
  db: SupabaseClient,
  accountId: string,
): Promise<{ key: string | null; corrupt: boolean }> {
  const { data, error } = await db
    .from('ai_configs')
    .select('embeddings_api_key')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data?.embeddings_api_key) return { key: null, corrupt: false }
  try {
    return { key: decrypt(data.embeddings_api_key), corrupt: false }
  } catch {
    console.error(
      `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`,
    )
    return { key: null, corrupt: true }
  }
}
