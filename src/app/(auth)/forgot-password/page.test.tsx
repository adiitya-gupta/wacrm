import React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  resetPasswordForEmail: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: mocks.createClient,
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import ForgotPasswordPage from './page';

describe('ForgotPasswordPage prerendering and redirect URL generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
    mocks.createClient.mockReturnValue({
      auth: {
        resetPasswordForEmail: mocks.resetPasswordForEmail,
      },
    });
  });

  it('prerenders without initializing Supabase client during component render', () => {
    const html = renderToString(<ForgotPasswordPage />);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(html).toContain('title');
  });

  it('safely handles missing environment variables during render without throwing', () => {
    mocks.createClient.mockImplementation(() => {
      throw new Error(
        "@supabase/ssr: Your project's URL and API key are required to create a Supabase client!"
      );
    });

    expect(() => {
      renderToString(<ForgotPasswordPage />);
    }).not.toThrow();

    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
