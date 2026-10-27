import type { AiMessageTemplates } from './types'
import { DEFAULT_AI_MESSAGE_TEMPLATES } from './defaults'

/**
 * Standard supported template variables.
 */
export const SUPPORTED_TEMPLATE_VARIABLES = [
  'business_name',
  'customer_name',
  'service_name',
  'service_benefits',
  'meeting_date',
  'meeting_time',
  'meeting_link',
  'pricing_info',
  'consultation_link',
] as const

export type TemplateVariableKey = (typeof SUPPORTED_TEMPLATE_VARIABLES)[number]

export const VARIABLE_FALLBACKS: Record<TemplateVariableKey, string> = {
  business_name: 'Our Team',
  customer_name: 'there',
  service_name: 'our services',
  service_benefits: 'save time and get reliable results',
  meeting_date: 'your scheduled date',
  meeting_time: 'the scheduled time',
  meeting_link: 'will be provided shortly',
  pricing_info: 'Customized based on your scope',
  consultation_link: 'Contact us for consultation details',
}

export interface TemplateValidationResult {
  valid: boolean
  unknownVariables: string[]
  error?: string
}

/**
 * Validate that a template string only contains recognized variables.
 */
export function validateTemplate(template: string): TemplateValidationResult {
  if (!template || typeof template !== 'string') {
    return { valid: true, unknownVariables: [] }
  }

  const variableRegex = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g
  const unknownVariables: string[] = []
  let match: RegExpExecArray | null

  while ((match = variableRegex.exec(template)) !== null) {
    const varName = match[1].toLowerCase()
    if (!SUPPORTED_TEMPLATE_VARIABLES.includes(varName as TemplateVariableKey)) {
      if (!unknownVariables.includes(varName)) {
        unknownVariables.push(varName)
      }
    }
  }

  if (unknownVariables.length > 0) {
    return {
      valid: false,
      unknownVariables,
      error: `Unsupported template variable(s): ${unknownVariables.map((v) => `{{${v}}}`).join(', ')}. Supported variables: ${SUPPORTED_TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(', ')}`,
    }
  }

  return { valid: true, unknownVariables: [] }
}

/**
 * Validate an entire collection of templates.
 */
export function validateAllTemplates(
  templates: Partial<AiMessageTemplates>,
): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {}

  for (const [key, val] of Object.entries(templates)) {
    if (typeof val === 'string' && val.trim()) {
      const res = validateTemplate(val)
      if (!res.valid && res.error) {
        errors[key] = res.error
      }
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  }
}

/**
 * Render a template string by interpolating variables safely with fallbacks.
 */
export function renderTemplate(
  template: string,
  variables: Partial<Record<TemplateVariableKey, string | null | undefined>>,
  customFallbacks?: Partial<Record<TemplateVariableKey, string>>,
): string {
  if (!template) return ''

  return template.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (_, rawKey) => {
    const key = rawKey.toLowerCase() as TemplateVariableKey
    const suppliedVal = variables[key]

    if (suppliedVal !== undefined && suppliedVal !== null && suppliedVal.trim() !== '') {
      return suppliedVal.trim()
    }

    if (customFallbacks && customFallbacks[key] !== undefined) {
      return customFallbacks[key]!
    }

    return VARIABLE_FALLBACKS[key] || ''
  })
}

/**
 * Retrieve an effective template with default fallback.
 */
export function getEffectiveTemplate(
  templates: Partial<AiMessageTemplates> | null | undefined,
  key: keyof AiMessageTemplates,
): string {
  if (templates && typeof templates[key] === 'string' && templates[key]!.trim()) {
    return templates[key]!.trim()
  }
  return DEFAULT_AI_MESSAGE_TEMPLATES[key] || ''
}
