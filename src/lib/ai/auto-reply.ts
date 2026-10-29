import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { generateReply } from './generate'
import { buildSystemPrompt } from './defaults'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import type { AiUsage, ConversationMode } from './types'
import {
  engineSendText,
  loadAccountMetaCredentials,
} from '@/lib/flows/meta-send'
import { sendTypingIndicator } from '@/lib/whatsapp/meta-api'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { checkAccountQuota, incrementAccountUsage } from '@/lib/billing/quota'
import { processConversationFlow } from './flow-manager'

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId?: string
  /** Meta's wamid of the customer message we're replying to. When set,
   *  a typing indicator (which also marks it read) is shown while the
   *  reply is generated. Optional so older callers keep working. */
  inboundMessageId?: string
  /**
   * Whether a prior automation step has already generated a customer-facing
   * reply for this inbound message. When true, AI stands down to prevent
   * double-replying.
   */
  automationReplied?: boolean
  /** Account-level conversation mode */
  conversationMode?: ConversationMode
  /** When true, forces AI generation even in automation_first mode (used by Handover to AI action) */
  forceAiReply?: boolean
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws — a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * Eligibility gates (any → silent no-op):
 *   - AI off / auto-reply disabled for the account
 *   - an automation already replied to this message
 *   - a human agent is assigned (they own the thread)
 *   - auto-reply was disabled for this conversation (prior handoff)
 *   - the per-conversation reply cap is reached
 *   - there's nothing to reply to
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 */
/**
 * Check whether the given account is the official OPSIYS account.
 * The consultative OPSIYS sales persona and agency pitch run ONLY for the
 * official OPSIYS account (configured via OPSIYS_ACCOUNT_ID).
 * Every other paying tenant generates replies using their own business
 * instructions, knowledge base documents, and model settings.
 */
export function isOpsiysAccount(accountId: string): boolean {
  const configured = process.env.OPSIYS_ACCOUNT_ID?.trim()
  if (!configured) return false
  return accountId === configured
}

export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const tStart = performance.now()
  const {
    accountId,
    conversationId,
    contactId,
    configOwnerUserId,
    inboundMessageId,
    automationReplied,
    conversationMode: callerMode,
    forceAiReply,
  } = args

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) {
      console.info(`[ai auto-reply] skipping: account ${accountId} auto-reply is disabled or config missing`)
      return
    }

    if (automationReplied) {
      console.info(`[ai auto-reply] skipping: message was already answered by an automation`)
      return
    }

    // Fetch conversation state, message context, token quota, and contact info in parallel
    const [convRes, messages, tokenQuota, contactRes] = await Promise.all([
      db
        .from('conversations')
        .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
        .eq('id', conversationId)
        .maybeSingle(),
      buildConversationContext(db, conversationId),
      checkAccountQuota(db, accountId, 'ai_tokens'),
      db
        .from('contacts')
        .select('name, phone')
        .eq('id', contactId)
        .maybeSingle(),
    ])

    const conv = convRes.data
    const convErr = convRes.error
    if (convErr || !conv) {
      console.warn(`[ai auto-reply] skipping: conversation ${conversationId} query failed or not found:`, convErr)
      return
    }
    if (conv.assigned_agent_id) {
      console.info(`[ai auto-reply] skipping: conversation ${conversationId} is owned by human agent ${conv.assigned_agent_id}`)
      return
    }
    if (conv.ai_autoreply_disabled) {
      console.info(`[ai auto-reply] skipping: auto-reply is disabled for conversation ${conversationId} (prior handoff)`)
      return
    }
    if (conv.ai_reply_count >= config.autoReplyMaxPerConversation) {
      console.info(`[ai auto-reply] skipping: conversation ${conversationId} reached cap (${conv.ai_reply_count}/${config.autoReplyMaxPerConversation})`)
      return
    }

    if (messages.length === 0) {
      console.info(`[ai auto-reply] skipping: conversation ${conversationId} has no message history`)
      return
    }

    if (!tokenQuota.allowed) {
      console.warn(`[ai auto-reply] account ${accountId} exceeded AI token quota: ${tokenQuota.reason}`)
      return
    }

    // In automation_first mode, check whether this conversation was explicitly handed over to AI.
    // If not handed over and not forceAiReply, active conversational automations take priority.
    const effectiveMode = callerMode ?? config.conversationMode ?? 'ai_agent'
    if (effectiveMode === 'automation_first' && !forceAiReply) {
      const { data: activeQual } = await db
        .from('ai_lead_qualifications')
        .select('state')
        .eq('conversation_id', conversationId)
        .maybeSingle()
      const isAlreadyHandedOver =
        typeof activeQual?.state === 'string' &&
        activeQual.state.length > 0 &&
        activeQual.state !== 'HUMAN_HANDOFF' &&
        activeQual.state !== 'MEETING_CANCELLED'

      if (!isAlreadyHandedOver) {
        const { data: autoResponders } = await db
          .from('automations')
          .select('id, trigger_type, trigger_config')
          .eq('account_id', accountId)
          .eq('is_active', true)
          .in('trigger_type', ['new_message_received', 'keyword_match'])

        if (autoResponders && autoResponders.length > 0) {
          const hasCatchAll = autoResponders.some(
            (a) => a.trigger_type === 'new_message_received' || !a.trigger_type,
          )
          if (hasCatchAll) {
            console.info(`[ai auto-reply] skipping: account ${accountId} has active new_message_received automation in automation_first mode`)
            return
          }

          // Check if any keyword automation matches the latest user turn from already loaded messages
          const userText = (latestUserMessage(messages) || '').toLowerCase()
          const matchesKeyword = autoResponders.some((a) => {
            if (a.trigger_type !== 'keyword_match') return false
            const cfg = a.trigger_config as { keywords?: string[] } | undefined
            if (!cfg?.keywords || cfg.keywords.length === 0) return true
            return cfg.keywords.some((k) => userText.includes(k.toLowerCase()))
          })

          if (matchesKeyword) {
            console.info(`[ai auto-reply] skipping: incoming message matched active keyword automation in automation_first mode`)
            return
          }
        }
      }
    }

    // Account-wide throttle on the shared BYO key
    const acctLimit = await checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      console.warn(`[ai auto-reply] account ${accountId} hit the per-account rate limit — skipping this inbound.`)
      return
    }

    // Fire typing indicator asynchronously without blocking pre-inference lookups
    if (inboundMessageId) {
      void showTypingIndicator(db, accountId, inboundMessageId).catch((err) =>
        console.warn('[ai auto-reply] typing indicator send failed:', err),
      )
    }

    const tPreDb = performance.now() - tStart

    // Ground the reply in the account's knowledge base (best-effort)
    const tKnowledgeStart = performance.now()
    const knowledge = await retrieveKnowledge(
      db,
      accountId,
      config,
      latestUserMessage(messages),
    )
    const tKnowledge = performance.now() - tKnowledgeStart

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
    })

    const contactRow = (contactRes?.data as { name?: string | null; phone?: string | null } | null) || null

    let text = ''
    let handoff = false
    let usage: AiUsage | null = null

    const tGenStart = performance.now()
    try {
      const flowResult = await processConversationFlow({
        db,
        accountId,
        conversationId,
        contactId,
        messages,
        config: {
          ...config,
          systemPrompt,
        },
        contactName: contactRow?.name || null,
        contactPhone: contactRow?.phone || null,
      })
      text = flowResult.text
      handoff = flowResult.handoff
    } catch (flowErr) {
      console.warn(
        '[ai auto-reply] Conversation flow manager error, falling back to standard generation:',
        flowErr,
      )
      const gen = await generateReply({
        config,
        systemPrompt,
        messages,
      })
      text = gen.text
      handoff = gen.handoff
      usage = gen.usage
    }
    const tGen = performance.now() - tGenStart

    // Record token spend on the account's BYO key. Fire-and-forget so it
    // never adds latency to the customer-facing send: `logAiUsage`
    // swallows its own errors, so the floating promise can't reject.
    // Logged regardless of handoff — the provider call happened either
    // way.
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
    })

    if (usage) {
      void incrementAccountUsage(db, accountId, {
        aiTokens: (usage.promptTokens || 0) + (usage.completionTokens || 0),
      })
    }

    let senderUserId: string = configOwnerUserId || ''
    if (!senderUserId) {
      const { data: adminProfile } = await db
        .from('profiles')
        .select('user_id')
        .eq('account_id', accountId)
        .limit(1)
        .maybeSingle()
      senderUserId = (adminProfile?.user_id as string | undefined) || '00000000-0000-0000-0000-000000000000'
    }

    if (handoff || !text) {
      console.info(`[ai auto-reply] handing off conversation ${conversationId} to human (handoff=${handoff}, emptyText=${!text})`)
      const summary = buildHandoffSummary({
        messages,
        replyCount: conv.ai_reply_count ?? 0,
      })
      const update: Record<string, unknown> = {
        ai_autoreply_disabled: true,
        ai_handoff_summary: summary,
      }
      // Only set the assignee when a target is configured AND the thread
      // isn't already owned — never stomp an existing human assignment.
      if (config.handoffAgentId && !conv.assigned_agent_id) {
        update.assigned_agent_id = config.handoffAgentId
      }
      await db.from('conversations').update(update).eq('id', conversationId)

      // Send the parting/handoff message if one was generated (e.g. opt-out confirmation or handoff notice)
      if (text && text.trim()) {
        try {
          await engineSendText({
            accountId,
            userId: senderUserId,
            conversationId,
            contactId,
            text,
            aiGenerated: true,
          })
        } catch (sendErr) {
          console.warn('[ai auto-reply] failed to send handoff message:', sendErr)
        }
      }
      return
    }

    // Atomically claim a reply slot: the cap check + increment happen in
    // one UPDATE, so concurrent inbounds can never overshoot the cap. If
    // another inbound just took the last slot, `claimed` is false and we
    // skip the send. (We consume a slot slightly before the send lands —
    // fail-safe: under-reply rather than over-reply.)
    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      },
    )
    if (claimErr) {
      // A real error here (vs. losing the cap race) is almost always a
      // deploy issue — e.g. `claim_ai_reply_slot` not EXECUTE-able by the
      // service role, or the migration not applied. Log it loudly: a
      // silent return makes "auto-reply never fires" undiagnosable.
      console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr)
      return
    }
    if (claimed !== true) {
      console.warn(`[ai auto-reply] skipping: lost cap race for conversation ${conversationId}`)
      return
    }

    console.info(`[ai auto-reply] sending generated reply (${text.length} chars) to conversation ${conversationId}`)
    const tOutboundStart = performance.now()
    await engineSendText({
      accountId,
      userId: senderUserId,
      conversationId,
      contactId,
      text,
      aiGenerated: true,
    })
    const tOutbound = performance.now() - tOutboundStart
    console.info(
      `[ai latency] total: ${Math.round(performance.now() - tStart)}ms (pre_db: ${Math.round(tPreDb)}ms, knowledge: ${Math.round(tKnowledge)}ms, gen: ${Math.round(tGen)}ms, outbound: ${Math.round(tOutbound)}ms) to conversation ${conversationId}`,
    )
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}

/**
 * Best-effort "typing…" for the inbound we're about to answer. Swallows
 * every failure (no WhatsApp config, bad token, Meta 4xx) with a warning
 * — the indicator is cosmetic, the reply is not.
 */
async function showTypingIndicator(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  inboundMessageId: string,
): Promise<void> {
  try {
    const { phoneNumberId, accessToken } = await loadAccountMetaCredentials(
      db,
      accountId,
    )
    await sendTypingIndicator({
      phoneNumberId,
      accessToken,
      messageId: inboundMessageId,
    })
  } catch (err) {
    console.warn('[ai auto-reply] typing indicator failed (continuing):', err)
  }
}
