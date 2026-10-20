import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isOpsiysAccount } from './auto-reply'
import { processOpsiysLeadConversation } from './opsiys-agent'
import type { AiConfig } from './types'

describe('Tenant-Specific AI Routing & Cross-Account Isolation', () => {
  const OPSIYS_ID = 'opsiys-official-account-id'
  const CUSTOMER_ID = 'paying-customer-dental-clinic'

  beforeEach(() => {
    process.env.OPSIYS_ACCOUNT_ID = OPSIYS_ID
  })

  it('identifies official OPSIYS account correctly based on OPSIYS_ACCOUNT_ID', () => {
    expect(isOpsiysAccount(OPSIYS_ID)).toBe(true)
    expect(isOpsiysAccount(CUSTOMER_ID)).toBe(false)
    expect(isOpsiysAccount('some-random-id')).toBe(false)
  })

  it('returns false for all accounts if OPSIYS_ACCOUNT_ID is unset', () => {
    delete process.env.OPSIYS_ACCOUNT_ID
    expect(isOpsiysAccount(OPSIYS_ID)).toBe(false)
    expect(isOpsiysAccount(CUSTOMER_ID)).toBe(false)
  })

  it('strictly throws a tenant boundary error if processOpsiysLeadConversation is called for non-OPSIYS tenant', async () => {
    const mockDb = {
      from: vi.fn(),
      rpc: vi.fn(),
    } as any

    const mockConfig: AiConfig = {
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'sk-test',
      baseUrl: null,
      systemPrompt: 'You are Dr. Smile Dental Clinic assistant',
      isActive: true,
      autoReplyEnabled: true,
      autoReplyMaxPerConversation: 5,
      handoffAgentId: null,
      embeddingsApiKey: null,
    }

    await expect(
      processOpsiysLeadConversation({
        db: mockDb,
        accountId: CUSTOMER_ID,
        conversationId: 'conv-1',
        contactId: 'contact-1',
        messages: [{ role: 'user', content: 'What are your dental cleaning hours?' }],
        config: mockConfig,
      }),
    ).rejects.toThrow(/Tenant boundary violation/)
  })
})
