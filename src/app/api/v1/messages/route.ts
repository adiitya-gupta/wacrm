// ============================================================
// POST /api/v1/messages — send a WhatsApp message via the public API.
//
// The headline public endpoint (issue #245). Unlike the dashboard's
// `/api/whatsapp/send` (which takes an internal `conversation_id`),
// this takes a phone number — what an external automation actually
// has — resolves-or-creates the contact + conversation, then runs the
// same shared send core.
//
// Auth: API key with the `messages:send` scope. Account context (and
// the service-role client) come from `requireApiKey`.
//
// Body:
//   {
//     "to": "+14155550123",                 // required, E.164
//     "type": "text",                        // text|template|image|video|document|audio (default: text)
//     "text": "Hello!",                      // text body, or media caption
//     "media_url": "https://…/file.pdf",     // required for image/video/document/audio
//     "filename": "invoice.pdf",             // optional, document filename
//     "template": {                          // required when type=template
//       "name": "order_update",
//       "language": "en_US",
//       "params": ["A123"] | { "body": [...] }   // array = positional body; object = structured
//     },
//     "reply_to_message_id": "<uuid>",       // optional, must be in the same conversation
//     "name": "Jane Doe"                     // optional, names a newly-created contact
//   }
//
// Response (201):
//   { "data": { "message_id", "whatsapp_message_id", "conversation_id",
//               "contact_id", "contact_created" } }
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import {
  sendMessageToConversation,
  validateSendMessageParams,
  SendMessageError,
} from '@/lib/whatsapp/send-message';
import { checkAccountQuota, incrementAccountUsage } from '@/lib/billing/quota';
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'messages:send');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const to = typeof body.to === 'string' ? body.to.trim() : '';
    if (!to) {
      return fail('bad_request', "'to' is required", 400);
    }

    const type = typeof body.type === 'string' ? body.type : 'text';

    // Unpack the optional `template` object into the flat params the
    // send core expects. `params` as an array → legacy positional body
    // params; as an object → structured header/body/button params.
    const template =
      body.template && typeof body.template === 'object'
        ? (body.template as Record<string, unknown>)
        : null;
    const templateParams = Array.isArray(template?.params)
      ? (template.params as unknown[]).filter(
          (p): p is string => typeof p === 'string'
        )
      : undefined;
    const templateMessageParams =
      template?.params && !Array.isArray(template.params)
        ? template.params
        : undefined;

    // Validate the message shape BEFORE resolveConversationByPhone
    // finds-or-creates a contact + conversation, so a bad payload 400s
    // without leaving an orphan contact/conversation behind.
    // Validated by `validateSendMessageParams` below; the cast just bridges
    // the untyped JSON body to the send-core param type.
    const interactivePayload =
      body.interactive_payload && typeof body.interactive_payload === 'object'
        ? (body.interactive_payload as InteractiveMessagePayload)
        : null;

    validateSendMessageParams({
      messageType: type,
      contentText: typeof body.text === 'string' ? body.text : null,
      mediaUrl: typeof body.media_url === 'string' ? body.media_url : null,
      templateName: typeof template?.name === 'string' ? template.name : null,
      interactivePayload,
    });

    // Check message quota before resolving contact or sending
    const quota = await checkAccountQuota(ctx.supabase, ctx.accountId, 'messages');
    if (!quota.allowed) {
      return fail('quota_exceeded', quota.reason || 'Monthly message quota exceeded', 402);
    }

    // Find-or-create the conversation for this phone, then send. Both
    // steps share `SendMessageError`, so one catch maps the whole
    // pipeline to the envelope.
    const resolved = await resolveConversationByPhone(
      ctx.supabase,
      ctx.accountId,
      to,
      typeof body.name === 'string' ? body.name : null
    );

    // Check if customer care window is open when attempting to send freeform text
    let sendMessageType = type;
    let sendTemplateName = typeof template?.name === 'string' ? template.name : null;
    let sendTemplateLanguage = typeof template?.language === 'string' ? template.language : null;
    let sendTemplateParams = templateParams;
    const sendTemplateMessageParams = templateMessageParams;

    if (sendMessageType === 'text') {
      const { data: recentInbound } = await ctx.supabase
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
        // Outside 24h window: Meta strictly rejects freeform text (Error 131047).
        // Find an approved template for this account to ensure message delivery.
        const { data: approvedTemplates } = await ctx.supabase
          .from('message_templates')
          .select('name, language')
          .eq('account_id', ctx.accountId)
          .eq('status', 'APPROVED');

        const fallbackTemplate = (approvedTemplates || []).find(
          (t: { name: string; language: string }) =>
            t.name === 'opsiys_welcome' || t.name.toLowerCase().includes('welcome')
        );

        if (fallbackTemplate) {
          console.log(
            `[api/v1/messages] 24h window closed for ${to}. Auto-routing freeform text to approved template "${fallbackTemplate.name}".`
          );
          sendMessageType = 'template';
          sendTemplateName = fallbackTemplate.name;
          sendTemplateLanguage = fallbackTemplate.language || 'en_US';
          sendTemplateParams = [typeof body.name === 'string' ? body.name : 'there'];
        }
      }
    }

    const result = await sendMessageToConversation(
      ctx.supabase,
      ctx.accountId,
      {
        conversationId: resolved.conversationId,
        messageType: sendMessageType,
        contentText: typeof body.text === 'string' ? body.text : null,
        mediaUrl: typeof body.media_url === 'string' ? body.media_url : null,
        filename: typeof body.filename === 'string' ? body.filename : null,
        templateName: sendTemplateName,
        templateLanguage: sendTemplateLanguage,
        templateParams: sendTemplateParams,
        templateMessageParams: sendTemplateMessageParams,
        interactivePayload,
        replyToMessageId:
          typeof body.reply_to_message_id === 'string'
            ? body.reply_to_message_id
            : null,
      }
    );

    await incrementAccountUsage(ctx.supabase, ctx.accountId, { messages: 1 });

    return ok(
      {
        message_id: result.messageId,
        whatsapp_message_id: result.whatsappMessageId,
        conversation_id: resolved.conversationId,
        contact_id: resolved.contactId,
        contact_created: resolved.contactCreated,
      },
      201
    );
  } catch (err) {
    if (err instanceof SendMessageError) {
      return fail(err.code, err.message, err.status);
    }
    return toApiErrorResponse(err);
  }
}
