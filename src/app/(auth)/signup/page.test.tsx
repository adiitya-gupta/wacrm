import React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  searchParamsGet: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: mocks.searchParamsGet,
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: mocks.createClient,
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import SignupPage from './page';

describe('SignupPage invite-only guard and prerender safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders invitation-only notice when invite query parameter is missing', () => {
    mocks.searchParamsGet.mockReturnValue(null);

    const html = renderToString(<SignupPage />);

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(html).toContain('Registration by Invitation Only');
    expect(html).toContain('Wattomation is an invite-only platform');
    expect(html).toContain('href="/login"');
  });

  it('renders registration form when valid invite token is provided', () => {
    mocks.searchParamsGet.mockImplementation((param: string) => {
      if (param === 'invite') return 'inv_valid_token_123';
      return null;
    });

    const html = renderToString(<SignupPage />);

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(html).toContain('inv_valid_token_123');
    expect(html).toContain('title'); // localized title key
    expect(html).not.toContain('Registration by Invitation Only');
  });

  it('prerenders safely even if client env variables are absent', () => {
    mocks.searchParamsGet.mockReturnValue(null);
    mocks.createClient.mockImplementation(() => {
      throw new Error("Missing Supabase credentials");
    });

    expect(() => {
      renderToString(<SignupPage />);
    }).not.toThrow();

    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
