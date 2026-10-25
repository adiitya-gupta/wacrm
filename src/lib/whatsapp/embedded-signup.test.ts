import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseMetaMessageEvent,
  loadFacebookSdk,
  launchEmbeddedSignup,
} from './embedded-signup';

type ListenerFn = (evt: Event | MessageEvent | { type: string; origin?: string; data?: string }) => void;

interface MockWindow {
  location: { origin: string };
  addEventListener: (event: string, cb: ListenerFn) => void;
  removeEventListener: (event: string, cb: ListenerFn) => void;
  dispatchEvent: (event: { type: string; origin?: string; data?: string }) => void;
  fbAsyncInit?: () => void;
  FB?: {
    init: (opts: unknown) => void;
    login: (cb: (res: { authResponse?: { code?: string } | null }) => void, opts?: unknown) => void;
  };
}

interface MockDocument {
  getElementById: (id: string) => HTMLElement | null;
  head: {
    appendChild: (el: HTMLScriptElement | Partial<HTMLScriptElement>) => void;
  };
  createElement: (tag: string) => Partial<HTMLScriptElement>;
}

describe('Embedded Signup Client Helpers', () => {
  let mockWindow: MockWindow;
  let mockDocument: MockDocument;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  beforeEach(() => {
    vi.restoreAllMocks();

    const listeners: Record<string, ListenerFn[]> = {};

    mockDocument = {
      getElementById: vi.fn().mockReturnValue(null),
      head: {
        appendChild: vi.fn((_el: HTMLScriptElement | Partial<HTMLScriptElement>) => {
          // Simulate script load if needed
        }),
      },
      createElement: vi.fn(() => ({
        id: '',
        src: '',
        async: false,
        defer: false,
      })),
    };

    mockWindow = {
      location: { origin: 'https://wattomation.example.com' },
      addEventListener: vi.fn((event: string, cb: ListenerFn) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(cb);
      }),
      removeEventListener: vi.fn((event: string, cb: ListenerFn) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter((f) => f !== cb);
        }
      }),
      dispatchEvent: vi.fn((event: { type: string; origin?: string; data?: string }) => {
        const cbs = listeners[event.type] || [];
        cbs.forEach((cb) => cb(event));
      }),
    };

    globalThis.window = mockWindow as unknown as Window & typeof globalThis;
    globalThis.document = mockDocument as unknown as Document;
  });

  afterEach(() => {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  });

  describe('parseMetaMessageEvent', () => {
    it('returns null for non-facebook origins', () => {
      const event = {
        origin: 'https://malicious-site.com',
        data: JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH' }),
      } as MessageEvent;
      expect(parseMetaMessageEvent(event)).toBeNull();
    });

    it('returns null for unrelated message types', () => {
      const event = {
        origin: 'https://www.facebook.com',
        data: JSON.stringify({ type: 'SOME_OTHER_EVENT', event: 'FINISH' }),
      } as MessageEvent;
      expect(parseMetaMessageEvent(event)).toBeNull();
    });

    it('returns null for non-JSON string data', () => {
      const event = {
        origin: 'https://www.facebook.com',
        data: 'not valid json',
      } as MessageEvent;
      expect(parseMetaMessageEvent(event)).toBeNull();
    });

    it('successfully parses valid WA_EMBEDDED_SIGNUP string payload', () => {
      const payload = {
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'FINISH',
        data: {
          phone_number_id: '123456789',
          waba_id: '987654321',
        },
      };
      const event = {
        origin: 'https://www.facebook.com',
        data: JSON.stringify(payload),
      } as MessageEvent;

      const result = parseMetaMessageEvent(event);
      expect(result).not.toBeNull();
      expect(result?.event).toBe('FINISH');
      expect(result?.data?.phone_number_id).toBe('123456789');
      expect(result?.data?.waba_id).toBe('987654321');
    });

    it('successfully parses valid WA_EMBEDDED_SIGNUP object payload', () => {
      const payload = {
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'FINISH',
        data: {
          phone_number_id: '999',
        },
      };
      const event = {
        origin: 'https://web.facebook.com',
        data: payload,
      } as MessageEvent;

      const result = parseMetaMessageEvent(event);
      expect(result?.event).toBe('FINISH');
      expect(result?.data?.phone_number_id).toBe('999');
    });
  });

  describe('loadFacebookSdk', () => {
    it('returns true immediately if FB already exists on window', async () => {
      mockWindow.FB = {
        init: vi.fn(),
        login: vi.fn(),
      };

      const result = await loadFacebookSdk('test_app_id');
      expect(result).toBe(true);
      expect(mockDocument.createElement).not.toHaveBeenCalled();
    });

    it('creates script element and initializes FB SDK', async () => {
      const loadPromise = loadFacebookSdk('1234567890');

      expect(mockDocument.createElement).toHaveBeenCalledWith('script');
      expect(mockDocument.head.appendChild).toHaveBeenCalled();

      // Trigger fbAsyncInit
      expect(typeof mockWindow.fbAsyncInit).toBe('function');
      mockWindow.FB = {
        init: vi.fn(),
        login: vi.fn(),
      };
      mockWindow.fbAsyncInit?.();

      const result = await loadPromise;
      expect(result).toBe(true);
      expect(mockWindow.FB.init).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: '1234567890',
          version: 'v21.0',
        })
      );
    });
  });

  describe('launchEmbeddedSignup', () => {
    it('triggers FB.login with config_id and response_type code', async () => {
      const mockLogin = vi.fn().mockImplementation((cb: (res: { authResponse?: { code?: string } }) => void) => {
        cb({ authResponse: { code: 'test_auth_code_xyz' } });
      });

      mockWindow.FB = {
        init: vi.fn(),
        login: mockLogin,
      };

      const onSuccess = vi.fn();
      const onCancel = vi.fn();

      await launchEmbeddedSignup({
        appId: 'app_123',
        configId: 'cfg_456',
        onSuccess,
        onCancel,
      });

      expect(mockLogin).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          config_id: 'cfg_456',
          response_type: 'code',
          override_default_response_type: true,
        })
      );

      expect(onSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'test_auth_code_xyz',
        })
      );
    });

    it('captures WABA and phone ID from message listener when finishing', async () => {
      let loginCallback: ((res: { authResponse?: { code?: string } }) => void) | null = null;

      mockWindow.FB = {
        init: vi.fn(),
        login: vi.fn().mockImplementation((cb: (res: { authResponse?: { code?: string } }) => void) => {
          loginCallback = cb;
        }),
      };

      const onSuccess = vi.fn();

      await launchEmbeddedSignup({
        appId: 'app_123',
        configId: 'cfg_456',
        onSuccess,
      });

      // Dispatch simulated Meta postMessage event
      mockWindow.dispatchEvent({
        type: 'message',
        origin: 'https://www.facebook.com',
        data: JSON.stringify({
          type: 'WA_EMBEDDED_SIGNUP',
          event: 'FINISH',
          data: {
            phone_number_id: 'phone_999',
            waba_id: 'waba_888',
          },
        }),
      });

      // Trigger login callback
      if (loginCallback) {
        (loginCallback as (res: { authResponse?: { code?: string } }) => void)({
          authResponse: { code: 'auth_code_123' },
        });
      }

      expect(onSuccess).toHaveBeenCalledWith({
        code: 'auth_code_123',
        phoneNumberId: 'phone_999',
        wabaId: 'waba_888',
      });
    });

    it('handles cancellation if user closes the login popup', async () => {
      mockWindow.FB = {
        init: vi.fn(),
        login: vi.fn().mockImplementation((cb: (res: { authResponse?: { code?: string } | null }) => void) => {
          cb({ authResponse: null });
        }),
      };

      const onSuccess = vi.fn();
      const onCancel = vi.fn();

      await launchEmbeddedSignup({
        appId: 'app_123',
        configId: 'cfg_456',
        onSuccess,
        onCancel,
      });

      expect(onCancel).toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();
    });
  });
});
