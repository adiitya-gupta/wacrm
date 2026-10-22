import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { checkAccountQuota, incrementAccountUsage } from '@/lib/billing/quota';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import { sendMessageToConversation } from '@/lib/whatsapp/send-message';
import type {
  WebsiteIntegration,
  WebsiteIntegrationRule,
  WebsiteEventPayload,
  WebsiteEventLog,
} from '@/types/website-integrations';

/**
 * Generate a new random site key.
 */
export function generateSiteKey(): string {
  return 'wk_live_' + crypto.randomBytes(16).toString('hex');
}

/**
 * Generate a new random webhook secret for HMAC signing.
 */
export function generateWebhookSecret(): string {
  return 'whsec_' + crypto.randomBytes(24).toString('hex');
}

/**
 * Fetch or bootstrap website integration credentials for an account.
 */
export async function getOrCreateWebsiteIntegration(
  db: SupabaseClient,
  accountId: string
): Promise<WebsiteIntegration> {
  const { data, error } = await db
    .from('website_integrations')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();

  if (data) {
    return data as WebsiteIntegration;
  }

  const site_key = generateSiteKey();
  const webhook_secret = generateWebhookSecret();

  const { data: created, error: insertErr } = await db
    .from('website_integrations')
    .insert({
      account_id: accountId,
      site_key,
      webhook_secret,
      domain_whitelist: [],
      is_active: true,
    })
    .select('*')
    .single();

  if (insertErr || !created) {
    throw new Error('Failed to create website integration credentials');
  }

  return created as WebsiteIntegration;
}

/**
 * Look up integration record by site_key (for public ingestion endpoints).
 */
export async function findIntegrationBySiteKey(
  db: SupabaseClient,
  siteKey: string
): Promise<WebsiteIntegration | null> {
  const { data } = await db
    .from('website_integrations')
    .select('*')
    .eq('site_key', siteKey)
    .eq('is_active', true)
    .maybeSingle();

  if (!data) return null;

  // Account governance check: Ensure owning account is active and approved
  const { data: account, error: accErr } = await db
    .from('accounts')
    .select('id, is_suspended, approval_status')
    .eq('id', data.account_id)
    .maybeSingle();

  if (accErr && (accErr.code === '42703' || accErr.message?.includes('approval_status'))) {
    const { data: fbAccount } = await db
      .from('accounts')
      .select('id, is_suspended')
      .eq('id', data.account_id)
      .maybeSingle();
    if (fbAccount?.is_suspended) {
      return null;
    }
    if (process.env.NODE_ENV !== 'test') {
      return null;
    }
  } else if (account) {
    if (account.is_suspended) return null;
    if (account.approval_status && account.approval_status !== 'approved') return null;
  }

  return data as WebsiteIntegration;
}

/**
 * Verify HMAC SHA-256 signature on an incoming website webhook request.
 * Header format expected: "t=<timestamp>,v1=<hex_signature>" or raw hex signature.
 */
export function verifyWebsiteWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string
): boolean {
  if (!signatureHeader || !secret) return false;

  let signature = signatureHeader;
  let timestamp: string | null = null;

  if (signatureHeader.includes('t=') && signatureHeader.includes('v1=')) {
    const parts = signatureHeader.split(',');
    for (const part of parts) {
      if (part.startsWith('t=')) timestamp = part.slice(2).trim();
      if (part.startsWith('v1=')) signature = part.slice(3).trim();
    }

    if (timestamp) {
      const now = Math.floor(Date.now() / 1000);
      const parsedTime = parseInt(timestamp, 10);
      // Replay tolerance: 10 minutes
      if (Number.isNaN(parsedTime) || Math.abs(now - parsedTime) > 600) {
        return false;
      }
    }
  }

  const payloadToSign = timestamp ? `${timestamp}.${rawBody}` : rawBody;
  const computed = crypto
    .createHmac('sha256', secret)
    .update(payloadToSign)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed, 'hex'),
      Buffer.from(signature, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Validate browser caller origin against configured domain whitelist.
 */
export function validateDomainOrigin(
  originHeader: string | null | undefined,
  refererHeader: string | null | undefined,
  whitelist: string[]
): boolean {
  // If no whitelist is specified, allow for local dev / unconstrained mode
  if (!whitelist || whitelist.length === 0) return true;

  const presented = originHeader || refererHeader;
  if (!presented) return false;

  try {
    const url = new URL(presented);
    const host = url.hostname.toLowerCase();

    return whitelist.some((allowed) => {
      const clean = allowed.trim().toLowerCase().replace(/^https?:\/\//, '');
      return host === clean || host.endsWith(`.${clean}`);
    });
  } catch {
    return false;
  }
}

/**
 * Replace {{variable}} tokens in message strings from event payload.
 */
export function interpolateTemplate(
  template: string,
  data: Record<string, unknown>
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const parts = path.split('.');
    let cur: unknown = data;
    for (const part of parts) {
      if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[part];
      } else {
        cur = undefined;
        break;
      }
    }
    return cur !== undefined && cur !== null ? String(cur) : '';
  });
}

export interface ProcessEventOptions {
  source: 'webhook' | 'sdk' | 'api' | 'test';
  origin?: string | null;
}

export interface ProcessEventResult {
  success: boolean;
  logId: string;
  status: 'processed' | 'accepted' | 'failed';
  dispatchedActions: Array<{
    action_type: string;
    success: boolean;
    result?: unknown;
    error?: string;
  }>;
  error?: string;
}

/**
 * Core processor for website events.
 * Connects website submissions to Contacts, Automation Rules, and WhatsApp messaging.
 */
export async function processWebsiteEvent(
  db: SupabaseClient,
  integration: WebsiteIntegration,
  payload: WebsiteEventPayload,
  options: ProcessEventOptions
): Promise<ProcessEventResult> {
  const { account_id, site_key, domain_whitelist } = integration;

  // 1. Domain origin check for SDK callers
  if (options.source === 'sdk' && options.origin) {
    const originAllowed = validateDomainOrigin(options.origin, null, domain_whitelist);
    if (!originAllowed) {
      throw new Error(`Origin '${options.origin}' is not in the allowed domain whitelist`);
    }
  }

  // 2. Distributed Rate Limiting
  const rateLimitKey = `site-event:${site_key}`;
  const rate = await checkRateLimit(rateLimitKey, RATE_LIMITS.publicApi);
  if (!rate.success) {
    throw new Error('Rate limit exceeded for this website integration. Please slow down requests.');
  }

  // 3. Idempotency Check
  const idempotencyKey = payload.idempotency_key?.trim() || null;
  if (idempotencyKey) {
    const { data: existing } = await db
      .from('website_event_logs')
      .select('*')
      .eq('account_id', account_id)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (existing) {
      return {
        success: existing.status === 'processed' || existing.status === 'accepted',
        logId: existing.id,
        status: existing.status,
        dispatchedActions: existing.dispatched_actions || [],
      };
    }
  }

  // 4. Initial Audit Log
  const { data: logEntry, error: logErr } = await db
    .from('website_event_logs')
    .insert({
      account_id,
      site_key,
      event_type: payload.event_type,
      idempotency_key: idempotencyKey,
      payload,
      status: 'accepted',
      dispatched_actions: [],
    })
    .select('id')
    .single();

  const logId = logEntry?.id || 'unknown';

  const dispatchedActions: Array<{
    action_type: string;
    success: boolean;
    result?: unknown;
    error?: string;
  }> = [];

  try {
    const phone = payload.phone?.trim();
    if (!phone) {
      throw new Error("Missing required 'phone' field in website event payload");
    }

    const contactName = payload.name?.trim() || 'Website Visitor';

    // 5. Find or create Contact & Conversation
    const resolved = await resolveConversationByPhone(
      db,
      account_id,
      phone,
      contactName
    );

    // If email or metadata was provided, update contact metadata
    if (payload.email) {
      await db
        .from('contacts')
        .update({ email: payload.email.trim() })
        .eq('id', resolved.contactId)
        .eq('account_id', account_id);
    }

    // 6. Match active website integration rules for this event type
    const { data: rules } = await db
      .from('website_integration_rules')
      .select('*')
      .eq('account_id', account_id)
      .eq('event_type', payload.event_type)
      .eq('is_active', true);

    const activeRules = (rules as WebsiteIntegrationRule[]) || [];

    // 7. Execute configured actions
    for (const rule of activeRules) {
      try {
        if (rule.action_type === 'send_whatsapp_message') {
          // Check message quota
          const quota = await checkAccountQuota(db, account_id, 'messages');
          if (!quota.allowed) {
            dispatchedActions.push({
              action_type: 'send_whatsapp_message',
              success: false,
              error: quota.reason || 'Quota exceeded',
            });
            continue;
          }

          const rawText = rule.config.message_body || 'Hello! Thank you for connecting with us.';
          const interpolated = interpolateTemplate(rawText, {
            ...payload,
            name: contactName,
            phone,
          });

          let sendMsgType = 'text';
          let sendTplName: string | undefined = undefined;
          let sendTplParams: string[] | undefined = undefined;

          // Check if customer care window is open
          const { data: recentInbound } = await db
            .from('messages')
            .select('created_at')
            .eq('conversation_id', resolved.conversationId)
            .eq('sender_type', 'customer')
            .order('created_at', { ascending: false })
            .limit(1);

          const hasRecentCustomerMessage =
            recentInbound &&
            recentInbound.length > 0 &&
            Date.now() - new Date(recentInbound[0].created_at).getTime() < 24 * 60 * 60 * 1000;

          if (!hasRecentCustomerMessage) {
            const { data: approvedTemplates } = await db
              .from('message_templates')
              .select('name, language')
              .eq('account_id', account_id)
              .eq('status', 'APPROVED');

            const fallbackTemplate = (approvedTemplates || []).find(
              (t: { name: string; language: string }) =>
                t.name === 'opsiys_welcome' || t.name.toLowerCase().includes('welcome')
            );

            if (fallbackTemplate) {
              sendMsgType = 'template';
              sendTplName = fallbackTemplate.name;
              sendTplParams = [contactName];
            }
          }

          // Dispatches through WhatsApp
          const res = await sendMessageToConversation(db, account_id, {
            conversationId: resolved.conversationId,
            messageType: sendMsgType,
            contentText: sendMsgType === 'text' ? interpolated : null,
            templateName: sendTplName,
            templateParams: sendTplParams,
          });

          // Increment usage
          await incrementAccountUsage(db, account_id, { messages: 1 });

          dispatchedActions.push({
            action_type: 'send_whatsapp_message',
            success: true,
            result: res,
          });
        } else if (rule.action_type === 'send_template') {
          const quota = await checkAccountQuota(db, account_id, 'messages');
          if (!quota.allowed) {
            dispatchedActions.push({
              action_type: 'send_template',
              success: false,
              error: quota.reason || 'Quota exceeded',
            });
            continue;
          }

          const templateName = rule.config.template_name;
          if (!templateName) {
            throw new Error('Template name is required for send_template rule');
          }

          const res = await sendMessageToConversation(db, account_id, {
            conversationId: resolved.conversationId,
            messageType: 'template',
            templateName,
            templateLanguage: rule.config.template_language || 'en',
            templateParams: rule.config.template_params || [],
          });

          await incrementAccountUsage(db, account_id, { messages: 1 });

          dispatchedActions.push({
            action_type: 'send_template',
            success: true,
            result: res,
          });
        } else if (rule.action_type === 'assign_tag') {
          const tagName = rule.config.tag_name || 'Website Lead';

          // Look up or create tag
          const { data: existingTag } = await db
            .from('tags')
            .select('id')
            .eq('account_id', account_id)
            .ilike('name', tagName)
            .maybeSingle();

          let tagId = existingTag?.id;
          if (!tagId) {
            const { data: newTag } = await db
              .from('tags')
              .insert({ account_id, name: tagName, color: '#3B82F6' })
              .select('id')
              .single();
            tagId = newTag?.id;
          }

          if (tagId) {
            await db
              .from('contact_tags')
              .insert({ contact_id: resolved.contactId, tag_id: tagId })
              .maybeSingle();

            dispatchedActions.push({
              action_type: 'assign_tag',
              success: true,
              result: { tagName, tagId },
            });
          }
        }
      } catch (actionErr) {
        const errorMsg = actionErr instanceof Error ? actionErr.message : String(actionErr);
        dispatchedActions.push({
          action_type: rule.action_type,
          success: false,
          error: errorMsg,
        });
      }
    }

    // 8. Update log entry status to processed
    await db
      .from('website_event_logs')
      .update({
        status: 'processed',
        dispatched_actions: dispatchedActions,
      })
      .eq('id', logId);

    return {
      success: true,
      logId,
      status: 'processed',
      dispatchedActions,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[website-event] Processing error:', err);
    await db
      .from('website_event_logs')
      .update({
        status: 'failed',
        error_message: errorMsg,
        dispatched_actions: dispatchedActions,
      })
      .eq('id', logId);

    return {
      success: false,
      logId,
      status: 'failed',
      dispatchedActions,
      error: errorMsg,
    };
  }
}
