import { describe, it, expect } from 'vitest'
import {
  validateTemplate,
  validateAllTemplates,
  renderTemplate,
  getEffectiveTemplate,
  SUPPORTED_TEMPLATE_VARIABLES,
} from './templates'

describe('AI Message Templates Engine', () => {
  it('validates supported template variables', () => {
    const validTpl =
      'Hello {{customer_name}}, welcome to {{business_name}}! We offer {{service_name}} which can help you {{service_benefits}}.'
    const res = validateTemplate(validTpl)
    expect(res.valid).toBe(true)
    expect(res.unknownVariables).toHaveLength(0)
  })

  it('detects and flags unsupported template variables', () => {
    const invalidTpl =
      'Hello {{customer_name}}, your order {{order_id}} with discount {{secret_code}} is ready.'
    const res = validateTemplate(invalidTpl)
    expect(res.valid).toBe(false)
    expect(res.unknownVariables).toEqual(['order_id', 'secret_code'])
    expect(res.error).toContain('Unsupported template variable(s)')
  })

  it('renders variables correctly with provided values', () => {
    const tpl =
      'Great choice! {{service_name}} will help you {{service_benefits}}. Meeting on {{meeting_date}} at {{meeting_time}}.'
    const output = renderTemplate(tpl, {
      service_name: 'Email Automation',
      service_benefits: 'nurture leads 24/7',
      meeting_date: 'Oct 28',
      meeting_time: '2:00 PM',
    })
    expect(output).toBe(
      'Great choice! Email Automation will help you nurture leads 24/7. Meeting on Oct 28 at 2:00 PM.',
    )
  })

  it('uses standard fallbacks when variables are missing or null', () => {
    const tpl = 'Welcome to {{business_name}}, {{customer_name}}!'
    const output = renderTemplate(tpl, {})
    expect(output).toBe('Welcome to Our Team, there!')
  })

  it('uses custom fallbacks when provided', () => {
    const tpl = 'Welcome to {{business_name}}, {{customer_name}}!'
    const output = renderTemplate(
      tpl,
      {},
      {
        business_name: 'Acme Corp',
        customer_name: 'valued guest',
      },
    )
    expect(output).toBe('Welcome to Acme Corp, valued guest!')
  })

  it('returns effective template with fallback to default', () => {
    const custom = { welcome: 'Custom Welcome!' }
    expect(getEffectiveTemplate(custom, 'welcome')).toBe('Custom Welcome!')
    expect(getEffectiveTemplate(custom, 'booking_confirmation')).toContain(
      'discovery consultation is confirmed',
    )
  })

  it('validates all templates in a collection', () => {
    const badCollection = {
      welcome: 'Hello {{customer_name}}',
      pricing: 'Price is {{fake_price}}',
    }
    const res = validateAllTemplates(badCollection)
    expect(res.valid).toBe(false)
    expect(res.errors.pricing).toBeDefined()
  })
})
