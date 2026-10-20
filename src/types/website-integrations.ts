export type WebsiteEventType =
  | 'lead.submitted'
  | 'user.registered'
  | 'appointment.booked'
  | 'order.updated'
  | 'custom';

export type WebsiteActionType =
  | 'send_whatsapp_message'
  | 'send_template'
  | 'assign_tag'
  | 'trigger_flow';

export interface WebsiteIntegration {
  id: string;
  account_id: string;
  site_key: string;
  webhook_secret: string;
  domain_whitelist: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WebsiteIntegrationRuleConfig {
  message_body?: string;
  template_name?: string;
  template_language?: string;
  template_params?: string[];
  tag_name?: string;
  flow_id?: string;
  recipient_phone_field?: string; // defaults to 'phone'
  recipient_name_field?: string; // defaults to 'name'
}

export interface WebsiteIntegrationRule {
  id: string;
  account_id: string;
  event_type: WebsiteEventType | string;
  action_type: WebsiteActionType;
  config: WebsiteIntegrationRuleConfig;
  is_active: boolean;
  created_at: string;
}

export interface WebsiteEventPayload {
  event_type: WebsiteEventType | string;
  phone: string;
  name?: string;
  email?: string;
  idempotency_key?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WebsiteEventLog {
  id: string;
  account_id: string;
  site_key: string;
  event_type: string;
  idempotency_key: string | null;
  payload: Record<string, unknown>;
  status: 'accepted' | 'processed' | 'failed' | 'retried';
  error_message: string | null;
  dispatched_actions: Array<{
    action_type: string;
    success: boolean;
    result?: unknown;
    error?: string;
  }>;
  created_at: string;
}
