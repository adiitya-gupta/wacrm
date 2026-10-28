import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { validateAiCredentials } from '@/lib/ai/validate'
import { embedTexts } from '@/lib/ai/embeddings'
import { AiError, type AiProvider } from '@/lib/ai/types'
import { normalizeOpenAiCompatibleBaseUrl } from '@/lib/ai/providers/openai-compatible'
import { canReuseStoredAiKey } from '@/lib/ai/stored-key'
import { getT } from '@/lib/i18n/translate'

import { validateAllTemplates } from '@/lib/ai/templates'

const t = getT('Api')

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * GET /api/ai/config
 *
 * Any member may read the config so the inbox/settings can reflect
 * whether AI is set up. The encrypted key is NEVER returned — only a
 * `has_key` flag; the settings form shows a masked placeholder.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    // 1. Fetch account metadata to ensure business_profile, conversation_flow, and message_templates
    // are ALWAYS retrieved even if migration 053 columns are not yet in ai_configs or if ai_configs is unconfigured.
    const { data: accountRow } = await supabase
      .from('accounts')
      .select('metadata')
      .eq('id', accountId)
      .maybeSingle()
    const accMeta = (accountRow?.metadata as Record<string, unknown>) ?? {}

    const cols =
      'provider, model, base_url, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, api_key, embeddings_api_key'

    interface ConfigFetchRow {
      api_key?: string | null
      embeddings_api_key?: string | null
      business_profile?: unknown
      conversation_flow?: unknown
      message_templates?: unknown
      [key: string]: unknown
    }

    let data: ConfigFetchRow | null = null
    let error: { code?: string; message?: string } | null = null
    const primaryRes = await supabase
      .from('ai_configs')
      .select(`${cols}, business_profile, conversation_flow, message_templates`)
      .eq('account_id', accountId)
      .maybeSingle()

    if (primaryRes.error && (primaryRes.error.code === '42703' || primaryRes.error.message?.includes('column'))) {
      const fallbackRes = await supabase
        .from('ai_configs')
        .select(cols)
        .eq('account_id', accountId)
        .maybeSingle()
      data = fallbackRes.data as ConfigFetchRow | null
      error = fallbackRes.error
    } else {
      data = primaryRes.data as ConfigFetchRow | null
      error = primaryRes.error
    }

    if (error) {
      console.error('[ai/config GET] fetch error:', error)
      return NextResponse.json(
        { error: t('ai.loadConfigFailed') },
        { status: 500 },
      )
    }

    const businessProfile = data?.business_profile ?? accMeta.ai_business_profile ?? null
    const conversationFlow = data?.conversation_flow ?? accMeta.ai_conversation_flow ?? null
    const messageTemplates = data?.message_templates ?? accMeta.ai_message_templates ?? null

    if (!data) {
      return NextResponse.json({
        configured: false,
        has_key: false,
        has_embeddings_key: false,
        business_profile: businessProfile,
        conversation_flow: conversationFlow,
        message_templates: messageTemplates,
      })
    }

    // The keys are selected only to derive the has_* flags; neither is
    // returned to the client.
    const { api_key, embeddings_api_key, ...safe } = data
    return NextResponse.json({
      configured: true,
      has_key: !!api_key,
      has_embeddings_key: !!embeddings_api_key,
      ...safe,
      business_profile: businessProfile,
      conversation_flow: conversationFlow,
      message_templates: messageTemplates,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/config  (admin+)
 *
 * Upsert the account's AI config. Validates the key with the provider
 * before persisting (mirrors the WhatsApp config verifying with Meta
 * first), then stores the key AES-256-GCM-encrypted. When `api_key` is
 * omitted the existing stored key is reused (the form sends it only
 * when the user re-enters it).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = await checkRateLimit(`ai-config:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad(t('common.invalidRequestBody'))

    const provider = body.provider as AiProvider
    if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'openai_compatible') {
      return bad(t('ai.providerInvalid'))
    }
    const model = typeof body.model === 'string' ? body.model.trim() : ''
    if (!model) return bad(t('ai.modelRequired'))

    const baseUrlProvided = 'base_url' in body
    const requestedBaseUrl = typeof body.base_url === 'string' ? body.base_url.trim() : ''

    const systemPrompt =
      typeof body.system_prompt === 'string' && body.system_prompt.trim()
        ? body.system_prompt.trim()
        : null
    const isActive = body.is_active === true
    const autoReplyEnabled = body.auto_reply_enabled === true

    let maxPer = Number(body.auto_reply_max_per_conversation)
    if (!Number.isFinite(maxPer)) maxPer = 3
    maxPer = Math.min(20, Math.max(1, Math.floor(maxPer)))

    // Handoff routing target for auto-reply. A non-empty string must be a
    // member of this account (else the conversation would be assigned to a
    // stranger); an empty string / null means "leave unassigned" (the
    // shared queue). Absent → left unchanged on update below.
    const rawHandoff =
      typeof body.handoff_agent_id === 'string' ? body.handoff_agent_id.trim() : ''
    const handoffProvided = 'handoff_agent_id' in body
    let handoffAgentId: string | null = null
    if (rawHandoff) {
      const { data: member } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('account_id', accountId)
        .eq('user_id', rawHandoff)
        .maybeSingle()
      if (!member) return bad(t('ai.handoffNotMember'))
      handoffAgentId = rawHandoff
    }

    const rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''

    // Embeddings key (optional, for semantic KB search): a non-empty
    // string sets/replaces it; an explicit null clears it; absent leaves
    // it unchanged. The form only sends it when the admin edits it.
    const rawEmbeddingsKey =
      typeof body.embeddings_api_key === 'string'
        ? body.embeddings_api_key.trim()
        : ''
    const clearEmbeddingsKey = body.embeddings_api_key === null

    // 1. Validate templates if provided
    if (body.message_templates && typeof body.message_templates === 'object') {
      const tplValidation = validateAllTemplates(body.message_templates)
      if (!tplValidation.valid) {
        const firstErr = Object.values(tplValidation.errors)[0]
        return bad(firstErr || 'Invalid message templates')
      }
    }

    // 2. Persist multi-tenant business profile, conversation flow, and message templates into accounts.metadata
    // This guarantees persistence across page reloads and tenant isolation even if ai_configs table columns are missing.
    const { data: currentAcc } = await supabase
      .from('accounts')
      .select('metadata')
      .eq('id', accountId)
      .maybeSingle()

    const existingMeta = (currentAcc?.metadata as Record<string, unknown>) ?? {}
    const updatedMeta: Record<string, unknown> = { ...existingMeta }
    let hasMetaChanges = false

    if (body.business_profile && typeof body.business_profile === 'object') {
      updatedMeta.ai_business_profile = body.business_profile
      hasMetaChanges = true
    }
    if (body.conversation_flow && typeof body.conversation_flow === 'object') {
      updatedMeta.ai_conversation_flow = body.conversation_flow
      hasMetaChanges = true
    }
    if (body.message_templates && typeof body.message_templates === 'object') {
      updatedMeta.ai_message_templates = body.message_templates
      hasMetaChanges = true
    }

    if (hasMetaChanges) {
      const { error: metaErr } = await supabase
        .from('accounts')
        .update({ metadata: updatedMeta })
        .eq('id', accountId)
      if (metaErr) {
        console.error('[ai/config POST] failed to update accounts.metadata:', metaErr)
        return NextResponse.json({ error: t('ai.saveConfigFailed') }, { status: 500 })
      }
    }

    // Reuse the stored key when the form didn't send a fresh one.
    const { data: existing } = await supabase
      .from('ai_configs')
      .select('id, provider, model, base_url, api_key')
      .eq('account_id', accountId)
      .maybeSingle()

    // If there is no existing key and no new key provided:
    // If user is not attempting to activate AI, saving the business profile / templates is complete.
    if (!rawKey && !existing) {
      if (isActive || autoReplyEnabled) {
        return bad(t('ai.apiKeyRequired'))
      }
      return NextResponse.json({ success: true, configured: false })
    }

    let baseUrl: string | null = null
    if (provider === 'openai_compatible') {
      const candidate = baseUrlProvided
        ? requestedBaseUrl
        : existing?.provider === 'openai_compatible'
          ? (existing.base_url ?? '').trim()
          : ''
      if (rawKey || (existing && (isActive || autoReplyEnabled))) {
        if (!candidate) return bad(t('ai.baseUrlRequired'))
        try {
          normalizeOpenAiCompatibleBaseUrl(candidate)
        } catch (err) {
          return bad(err instanceof AiError ? err.message : t('ai.baseUrlInvalid'))
        }
      }
      baseUrl = candidate || null
    }

    // Only spend a provider round-trip when credentials that affect
    // reachability actually changed. If credentials did not change, we avoid
    // unnecessary provider calls and avoid failing if the stored encrypted key
    // cannot be decrypted during a non-credential save.
    const credentialsChanged =
      !existing ||
      rawKey !== '' ||
      provider !== existing.provider ||
      model !== existing.model ||
      baseUrl !== (existing.base_url ?? null)

    let apiKeyPlain: string
    if (credentialsChanged) {
      if (rawKey) {
        apiKeyPlain = rawKey
      } else if (existing?.api_key && canReuseStoredAiKey(existing, provider, baseUrl)) {
        try {
          apiKeyPlain = decrypt(existing.api_key)
        } catch {
          return bad(t('ai.storedKeyReenter'))
        }
      } else {
        return bad(t('ai.apiKeyRequired'))
      }

      try {
        await validateAiCredentials({
          provider,
          model,
          apiKey: apiKeyPlain,
          baseUrl,
          systemPrompt,
          isActive,
          autoReplyEnabled,
          autoReplyMaxPerConversation: maxPer,
          handoffAgentId: null,
          embeddingsApiKey: null,
        })
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            { error: err.message, code: err.code },
            { status: 400 },
          )
        }
        console.error('[ai/config POST] validation error:', err)
        return bad(t('ai.validateWithProviderFailed'))
      }
    }

    // Validate a new embeddings key before storing (a cheap 1-input
    // embed), same "verify before save" discipline as the chat key.
    if (rawEmbeddingsKey) {
      try {
        await embedTexts(rawEmbeddingsKey, ['ping'])
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            { error: t('ai.embeddingsKeyError', { message: err.message }), code: err.code },
            { status: 400 },
          )
        }
        console.error('[ai/config POST] embeddings validation error:', err)
        return bad(t('ai.validateEmbeddingsFailed'))
      }
    }

    const encryptedKey = rawKey ? encrypt(rawKey) : null
    const shared: Record<string, unknown> = {
      provider,
      model,
      base_url: baseUrl,
      system_prompt: systemPrompt,
      is_active: isActive,
      auto_reply_enabled: autoReplyEnabled,
      auto_reply_max_per_conversation: maxPer,
    }

    if (body.message_templates && typeof body.message_templates === 'object') {
      shared.message_templates = body.message_templates
    }
    if (body.business_profile && typeof body.business_profile === 'object') {
      shared.business_profile = body.business_profile
    }
    if (body.conversation_flow && typeof body.conversation_flow === 'object') {
      shared.conversation_flow = body.conversation_flow
    }

    // Only touch the handoff target when the form actually sent the field,
    // so a partial save (e.g. flipping a toggle) doesn't wipe it.
    if (handoffProvided) shared.handoff_agent_id = handoffAgentId
    if (rawEmbeddingsKey) {
      shared.embeddings_api_key = encrypt(rawEmbeddingsKey)
    } else if (clearEmbeddingsKey) {
      shared.embeddings_api_key = null
    }

    if (existing) {
      const updatePayload: Record<string, unknown> = encryptedKey ? { ...shared, api_key: encryptedKey } : { ...shared }
      let { error: upErr } = await supabase
        .from('ai_configs')
        .update(updatePayload)
        .eq('account_id', accountId)

      // Fallback if migration 053 columns are not yet in schema cache
      if (upErr && (upErr.code === '42703' || upErr.message?.includes('column'))) {
        const cleanPayload = { ...updatePayload }
        delete cleanPayload.business_profile
        delete cleanPayload.conversation_flow
        delete cleanPayload.message_templates
        const retry = await supabase
          .from('ai_configs')
          .update(cleanPayload)
          .eq('account_id', accountId)
        upErr = retry.error
      }

      if (upErr) {
        console.error('[ai/config POST] update error:', upErr)
        return NextResponse.json(
          { error: t('ai.saveConfigFailed') },
          { status: 500 },
        )
      }
    } else if (encryptedKey) {
      const insertPayload: Record<string, unknown> = {
        account_id: accountId,
        created_by: userId,
        api_key: encryptedKey,
        ...shared,
      }
      let { error: insErr } = await supabase.from('ai_configs').insert(insertPayload)

      // Fallback if migration 053 columns are not yet in schema cache
      if (insErr && (insErr.code === '42703' || insErr.message?.includes('column'))) {
        const cleanPayload = { ...insertPayload }
        delete cleanPayload.business_profile
        delete cleanPayload.conversation_flow
        delete cleanPayload.message_templates
        const retry = await supabase.from('ai_configs').insert(cleanPayload)
        insErr = retry.error
      }

      if (insErr) {
        console.error('[ai/config POST] insert error:', insErr)
        return NextResponse.json(
          { error: t('ai.saveConfigFailed') },
          { status: 500 },
        )
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/ai/config  (admin+)
 *
 * Removes the account's AI config (turns everything off and forgets the
 * key). Also used to recover from a corrupted encrypted key.
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase
      .from('ai_configs')
      .delete()
      .eq('account_id', accountId)
    if (error) {
      console.error('[ai/config DELETE] error:', error)
      return NextResponse.json(
        { error: t('ai.deleteConfigFailed') },
        { status: 500 },
      )
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
