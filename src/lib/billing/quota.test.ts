import { describe, expect, it, vi } from 'vitest';
import { checkAccountQuota, getCurrentBillingPeriod } from './quota';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('Billing Quota Engine', () => {
  it('returns valid billing period format YYYY-MM', () => {
    const period = getCurrentBillingPeriod();
    expect(period).toMatch(/^\d{4}-\d{2}$/);
  });

  it('allows message send within plan quota', async () => {
    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'subscriptions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { plan_id: 'starter', status: 'active' },
                }),
              }),
            }),
          };
        }
        if (table === 'account_usage_metrics') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { messages_count: 50 },
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    const res = await checkAccountQuota(mockDb, 'acc-1', 'messages', 1);
    expect(res.allowed).toBe(true);
    expect(res.current).toBe(50);
    expect(res.quota).toBe(1000); // Starter quota
  });

  it('rejects message send when quota is exhausted', async () => {
    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'subscriptions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { plan_id: 'starter', status: 'active' },
                }),
              }),
            }),
          };
        }
        if (table === 'account_usage_metrics') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { messages_count: 1000 },
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    const res = await checkAccountQuota(mockDb, 'acc-1', 'messages', 1);
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('Monthly message quota exceeded');
  });

  it('blocks actions for suspended or past_due subscriptions', async () => {
    const mockDb = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { plan_id: 'starter', status: 'past_due' },
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const res = await checkAccountQuota(mockDb, 'acc-1', 'messages');
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('past_due');
  });
});
