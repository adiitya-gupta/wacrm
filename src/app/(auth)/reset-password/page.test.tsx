import React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
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

// Mock next/link to render simple anchor tag for SSR
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import ResetPasswordPage from './page';

describe('ResetPasswordPage prerendering and client lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockReturnValue({
      auth: {
        getUser: mocks.getUser,
        updateUser: mocks.updateUser,
      },
    });
  });

  it('prerenders without initializing Supabase client during component render', () => {
    // When Next.js statically prerenders the page at build time,
    // createClient() must NOT be called in the render body.
    const html = renderToString(<ResetPasswordPage />);

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(html).toContain('checking');
  });

  it('safely handles missing environment variables during render without throwing', () => {
    mocks.createClient.mockImplementation(() => {
      throw new Error(
        "@supabase/ssr: Your project's URL and API key are required to create a Supabase client!"
      );
    });

    expect(() => {
      renderToString(<ResetPasswordPage />);
    }).not.toThrow();

    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('renders expired state immediately when query error or error_code is present', () => {
    mocks.searchParamsGet.mockImplementation((param: string) => {
      if (param === 'error_code') return 'otp_expired';
      if (param === 'error_description') return 'Email link is invalid or has expired';
      return null;
    });

    const html = renderToString(<ResetPasswordPage />);
    expect(html).toContain('expiredTitle');
    expect(html).toContain('Email link is invalid or has expired');
    expect(html).toContain('requestNewLink');
  });
});
