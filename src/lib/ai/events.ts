import type { SupabaseClient } from '@supabase/supabase-js'
import { addContactTagIfAbsent } from '@/lib/contacts/tag-write'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'

export type AiOutcomeEventType =
  | 'lead_qualified'
  | 'meeting_booked'
  | 'conversation_handed_off'
  | 'customer_opted_out'

export interface AiOutcomeEventPayload {
  type: AiOutcomeEventType
  accountId: string
  contactId: string
  conversationId: string
  timestamp?: string
  idempotencyKey?: string
  data?: {
    meetingId?: string
    serviceName?: string
    leadSummary?: string
    budget?: string
    notes?: string
    handoffReason?: string
    contactName?: string
    [key: string]: unknown
  }
}

export interface AiOutcomeDispatchResult {
  success: boolean
  dealCreated?: boolean
  dealId?: string
  tagApplied?: string
  error?: string
}

/**
 * Find an existing tag by name in the account, or create it if absent.
 */
async function findOrCreateTagByName(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  tagName: string,
  color = '#3b82f6',
): Promise<string | null> {
  try {
    const { data: existing } = await db
      .from('tags')
      .select('id')
      .eq('account_id', accountId)
      .ilike('name', tagName)
      .maybeSingle()

    if (existing?.id) {
      return existing.id as string
    }

    const { data: created, error } = await db
      .from('tags')
      .insert({
        account_id: accountId,
        user_id: userId,
        name: tagName,
        color,
      })
      .select('id')
      .maybeSingle()

    if (error || !created) {
      console.warn('[ai-events] tag creation failed:', error?.message)
      return null
    }

    return created.id as string
  } catch (err) {
    console.warn('[ai-events] findOrCreateTagByName error:', err)
    return null
  }
}

/**
 * Clean numeric parse for budget strings ($1,500 -> 1500).
 */
function parseBudgetValue(raw?: string): number {
  if (!raw) return 0
  const cleaned = raw.replace(/[^0-9.]/g, '')
  const val = parseFloat(cleaned)
  return Number.isFinite(val) ? val : 0
}

/**
 * Dispatch an AI outcome event to CRM deals, tags, pending execution sweeps,
 * and outbound webhooks with full multi-tenant isolation.
 */
export async function dispatchAiOutcomeEvent(
  db: SupabaseClient,
  event: AiOutcomeEventPayload,
): Promise<AiOutcomeDispatchResult> {
  const result: AiOutcomeDispatchResult = { success: true }

  try {
    // Multi-tenant boundary check: verify conversation & contact belong to account
    const [contactCheck, convCheck] = await Promise.all([
      db
        .from('contacts')
        .select('id, user_id, name')
        .eq('id', event.contactId)
        .eq('account_id', event.accountId)
        .maybeSingle(),
      db
        .from('conversations')
        .select('id, user_id')
        .eq('id', event.conversationId)
        .eq('account_id', event.accountId)
        .maybeSingle(),
    ])

    if (!contactCheck.data || !convCheck.data) {
      console.warn(
        `[ai-events] rejecting dispatch: contact (${event.contactId}) or conversation (${event.conversationId}) does not belong to account ${event.accountId}`,
      )
      return { success: false, error: 'tenant_mismatch' }
    }

    const senderUserId =
      (convCheck.data.user_id as string) || (contactCheck.data.user_id as string)

    switch (event.type) {
      case 'meeting_booked': {
        // 1. Tag the contact
        const tagId = await findOrCreateTagByName(
          db,
          event.accountId,
          senderUserId,
          'Meeting Booked',
          '#10b981',
        )
        if (tagId) {
          await addContactTagIfAbsent(db, {
            accountId: event.accountId,
            contactId: event.contactId,
            tagId,
          }).catch((err) => console.warn('[ai-events] tag write failed:', err))
          result.tagApplied = 'Meeting Booked'
        }

        // 2. Create Deal in CRM Pipeline (Idempotent)
        try {
          // Look up account's default currency
          const { data: acct } = await db
            .from('accounts')
            .select('default_currency')
            .eq('id', event.accountId)
            .maybeSingle()

          // Find the default or first pipeline
          const { data: pipelines } = await db
            .from('pipelines')
            .select('id')
            .eq('account_id', event.accountId)
            .order('created_at', { ascending: true })
            .limit(1)

          const pipelineId = pipelines?.[0]?.id as string | undefined

          if (pipelineId) {
            // Find first stage
            const { data: stages } = await db
              .from('pipeline_stages')
              .select('id')
              .eq('pipeline_id', pipelineId)
              .order('position', { ascending: true })
              .limit(1)

            const stageId = stages?.[0]?.id as string | undefined

            if (stageId) {
              // Idempotency: verify if a deal for this conversation already exists
              const { data: existingDeal } = await db
                .from('deals')
                .select('id')
                .eq('account_id', event.accountId)
                .eq('conversation_id', event.conversationId)
                .maybeSingle()

              if (!existingDeal) {
                const dealTitle = `Consultation: ${event.data?.serviceName || 'Service'} (${contactCheck.data.name || 'Lead'})`
                const dealValue = parseBudgetValue(event.data?.budget)

                const { data: newDeal, error: dealErr } = await db
                  .from('deals')
                  .insert({
                    account_id: event.accountId,
                    user_id: senderUserId,
                    pipeline_id: pipelineId,
                    stage_id: stageId,
                    contact_id: event.contactId,
                    conversation_id: event.conversationId,
                    title: dealTitle,
                    value: dealValue,
                    currency: (acct?.default_currency as string) || 'USD',
                    status: 'open',
                    notes: event.data?.leadSummary || 'Booked via WhatsApp AI Agent',
                  })
                  .select('id')
                  .maybeSingle()

                if (!dealErr && newDeal) {
                  result.dealCreated = true
                  result.dealId = newDeal.id as string
                  console.info(
                    `[ai-events] created CRM deal ${newDeal.id} for consultation in account ${event.accountId}`,
                  )
                }
              }
            }
          }
        } catch (dealErr) {
          console.warn('[ai-events] deal creation error (non-fatal):', dealErr)
        }

        // 3. Dispatch outbound webhook
        await dispatchWebhookEvent(db, event.accountId, 'ai.meeting_booked', {
          conversation_id: event.conversationId,
          contact_id: event.contactId,
          meeting_id: event.data?.meetingId,
          service_name: event.data?.serviceName,
          lead_summary: event.data?.leadSummary,
        }).catch(() => {})

        break
      }

      case 'lead_qualified': {
        // Tag contact
        const tagId = await findOrCreateTagByName(
          db,
          event.accountId,
          senderUserId,
          'Qualified Lead',
          '#6366f1',
        )
        if (tagId) {
          await addContactTagIfAbsent(db, {
            accountId: event.accountId,
            contactId: event.contactId,
            tagId,
          }).catch((err) => console.warn('[ai-events] tag write failed:', err))
          result.tagApplied = 'Qualified Lead'
        }

        // Dispatch outbound webhook
        await dispatchWebhookEvent(db, event.accountId, 'ai.lead_qualified', {
          conversation_id: event.conversationId,
          contact_id: event.contactId,
          service_name: event.data?.serviceName,
          lead_summary: event.data?.leadSummary,
        }).catch(() => {})

        break
      }

      case 'customer_opted_out': {
        // Ensure auto-reply is disabled
        await db
          .from('conversations')
          .update({
            ai_autoreply_disabled: true,
            ai_handoff_summary: 'Customer opted out of automated messaging.',
          })
          .eq('id', event.conversationId)

        // Cancel any pending automated waits/follow-ups for this contact
        await db
          .from('automation_pending_executions')
          .update({ status: 'cancelled' })
          .eq('account_id', event.accountId)
          .eq('contact_id', event.contactId)
          .in('status', ['pending', 'awaiting_reply'])

        // Tag contact
        const tagId = await findOrCreateTagByName(
          db,
          event.accountId,
          senderUserId,
          'Opted Out',
          '#ef4444',
        )
        if (tagId) {
          await addContactTagIfAbsent(db, {
            accountId: event.accountId,
            contactId: event.contactId,
            tagId,
          }).catch((err) => console.warn('[ai-events] tag write failed:', err))
          result.tagApplied = 'Opted Out'
        }

        // Dispatch outbound webhook
        await dispatchWebhookEvent(db, event.accountId, 'ai.customer_opted_out', {
          conversation_id: event.conversationId,
          contact_id: event.contactId,
        }).catch(() => {})

        break
      }

      case 'conversation_handed_off': {
        // Ensure auto-reply disabled
        await db
          .from('conversations')
          .update({
            ai_autoreply_disabled: true,
            status: 'pending',
          })
          .eq('id', event.conversationId)

        // Cancel scheduled bot follow-ups so they don't interrupt the human
        await db
          .from('automation_pending_executions')
          .update({ status: 'cancelled' })
          .eq('account_id', event.accountId)
          .eq('contact_id', event.contactId)
          .in('status', ['pending', 'awaiting_reply'])

        // Tag contact
        const tagId = await findOrCreateTagByName(
          db,
          event.accountId,
          senderUserId,
          'Human Handoff',
          '#f59e0b',
        )
        if (tagId) {
          await addContactTagIfAbsent(db, {
            accountId: event.accountId,
            contactId: event.contactId,
            tagId,
          }).catch((err) => console.warn('[ai-events] tag write failed:', err))
          result.tagApplied = 'Human Handoff'
        }

        // Dispatch outbound webhook
        await dispatchWebhookEvent(db, event.accountId, 'ai.conversation_handed_off', {
          conversation_id: event.conversationId,
          contact_id: event.contactId,
          reason: event.data?.handoffReason || 'Customer requested human assistance',
        }).catch(() => {})

        break
      }
    }

    return result
  } catch (err) {
    console.error('[ai-events] dispatchAiOutcomeEvent error:', err)
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
