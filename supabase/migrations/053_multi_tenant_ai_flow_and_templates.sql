-- ============================================================
-- 053_multi_tenant_ai_flow_and_templates.sql
-- Multi-Tenant AI Conversation Flow & Template Engine
-- ============================================================

SET search_path TO public, extensions;

-- 1. Extend ai_configs with business profile, conversation flow config, and message templates
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS business_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS conversation_flow JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS message_templates JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2. Extend ai_lead_qualifications with rich deterministic flow state
ALTER TABLE ai_lead_qualifications
  ADD COLUMN IF NOT EXISTS flow_state JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Index for fast state lookup
CREATE INDEX IF NOT EXISTS idx_ai_lead_qualifications_flow_state
  ON ai_lead_qualifications USING gin (flow_state);
