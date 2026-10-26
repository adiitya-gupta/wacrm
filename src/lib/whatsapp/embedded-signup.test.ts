import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isAllowedMetaOrigin,
  extractEmbeddedSignupData,
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

  describe('isAllowedMetaOrigin', () => {
    it('accepts valid Meta origins', () => {
      expect(isAllowedMetaOrigin('https://facebook.com')).toBe(true);
      expect(isAllowedMetaOrigin('https://www.facebook.com')).toBe(true);
      expect(isAllowedMetaOrigin('https://web.facebook.com')).toBe(true);
      expect(isAllowedMetaOrigin('https://m.facebook.com')).toBe(true);
      expect(isAllowedMetaOrigin('https://connect.facebook.com')).toBe(true);
    });

    it('rejects untrusted or invalid origins', () => {
      expect(isAllowedMetaOrigin('https://malicious-facebook.com')).toBe(false);
      expect(isAllowedMetaOrigin('https://notfacebook.com')).toBe(false);
      expect(isAllowedMetaOrigin('http://www.facebook.com')).toBe(false);
      expect(isAllowedMetaOrigin('javascript:alert(1)')).toBe(false);
      expect(isAllowedMetaOrigin('')).toBe(false);
      expect(isAllowedMetaOrigin(null as unknown as string)).toBe(false);
    });
  });

  describe('extractEmbeddedSignupData', () => {
    it('extracts standard snake_case IDs from data wrapper', () => {
      const res = extractEmbeddedSignupData({
        data: {
          waba_id: '999111',
          phone_number_id: '888222',
          business_id: '777333',
          current_step: 'complete',
        },
      });
      expect(res.wabaId).toBe('999111');
      expect(res.phoneNumberId).toBe('888222');
      expect(res.businessId).toBe('777333');
      expect(res.currentStep).toBe('complete');
    });

    it('extracts camelCase IDs', () => {
      const res = extractEmbeddedSignupData({
        data: {
          wabaId: '12345',
          phoneNumberId: '67890',
          businessId: '11223',
        },
      });
      expect(res.wabaId).toBe('12345');
      expect(res.phoneNumberId).toBe('67890');
      expect(res.businessId).toBe('11223');
    });

    it('extracts alternate Meta field names (whatsapp_business_account_id, messaging_account_id)', () => {
      const res1 = extractEmbeddedSignupData({
        data: {
          whatsapp_business_account_id: '555666',
          owner_business_id: '444333',
        },
      });
      expect(res1.wabaId).toBe('555666');
      expect(res1.businessId).toBe('444333');

      const res2 = extractEmbeddedSignupData({
        data: {
          messaging_account_id: '777888',
        },
      });
      expect(res2.wabaId).toBe('777888');
    });

    it('extracts modern Meta v5 messaging_account_ids plural array and string', () => {
      // Modern Meta v5 payload structure with array of messaging_account_ids
      const res1 = extractEmbeddedSignupData({
        data: {
          phone_number_id: '111222333',
          messaging_account_ids: ['999888777'],
          business_id: '555444333',
        },
      });
      expect(res1.wabaId).toBe('999888777');
      expect(res1.phoneNumberId).toBe('111222333');
      expect(res1.businessId).toBe('555444333');

      // messaging_account_ids as a single string
      const res2 = extractEmbeddedSignupData({
        data: {
          messaging_account_ids: '888777666',
        },
      });
      expect(res2.wabaId).toBe('888777666');

      // Array with leading empty or whitespace items
      const res3 = extractEmbeddedSignupData({
        data: {
          messaging_account_ids: ['', '  ', '777666555'],
        },
      });
      expect(res3.wabaId).toBe('777666555');

      // camelCase messagingAccountIds array and string
      const res4 = extractEmbeddedSignupData({
        data: {
          messagingAccountIds: ['666555444'],
          phoneNumber: '111222',
        },
      });
      expect(res4.wabaId).toBe('666555444');
      expect(res4.phoneNumberId).toBe('111222');

      const res5 = extractEmbeddedSignupData({
        data: {
          whatsappBusinessAccountId: '555444111',
          ownerBusinessId: '999000',
        },
      });
      expect(res5.wabaId).toBe('555444111');
      expect(res5.businessId).toBe('999000');
    });

    it('extracts from flat top-level payload', () => {
      const res = extractEmbeddedSignupData({
        waba_id: '101010',
        phone_number_id: '202020',
      });
      expect(res.wabaId).toBe('101010');
      expect(res.phoneNumberId).toBe('202020');
    });

    it('extracts from double-nested data.data structure', () => {
      const res = extractEmbeddedSignupData({
        data: {
          data: {
            waba_id: '303030',
            phone_number_id: '404040',
          },
        },
      });
      expect(res.wabaId).toBe('303030');
      expect(res.phoneNumberId).toBe('404040');
    });

    it('returns empty object for null, undefined, or empty objects', () => {
      expect(extractEmbeddedSignupData(null)).toEqual({});
      expect(extractEmbeddedSignupData(undefined)).toEqual({});
      expect(extractEmbeddedSignupData({})).toEqual({});
    });
  });

  describe('parseMetaMessageEvent', () => {
    it('returns null for non-facebook origins', () => {
      const event = {
        origin: 'https://malicious-site.com',
        data: JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH' }),
      } as MessageEvent;
      expect(parseMetaMessageEvent(event)).toBeNull();
    });

    it('returns null for unrelated message types without finish event', () => {
      const event = {
        origin: 'https://www.facebook.com',
        data: JSON.stringify({ type: 'SOME_OTHER_EVENT', event: 'OTHER_ACTION' }),
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
          business_id: '555666777',
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
      expect(result?.data?.business_id).toBe('555666777');
    });

    it('successfully parses valid WA_EMBEDDED_SIGNUP object payload from web.facebook.com', () => {
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

    it('successfully parses Meta v5 postMessage with messaging_account_ids array', () => {
      const payload = {
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'FINISH',
        data: {
          phone_number_id: '999888111',
          messaging_account_ids: ['555444333'],
          business_id: '123456789',
        },
      };
      const event = {
        origin: 'https://www.facebook.com',
        data: payload,
      } as MessageEvent;

      const result = parseMetaMessageEvent(event);
      expect(result?.event).toBe('FINISH');
      expect(result?.data?.waba_id).toBe('555444333');
      expect(result?.data?.phone_number_id).toBe('999888111');
      expect(result?.data?.business_id).toBe('123456789');
    });

    it('handles FINISH_ONLY_WABA and FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING events', () => {
      const event1 = {
        origin: 'https://facebook.com',
        data: {
          type: 'WA_EMBEDDED_SIGNUP',
          event: 'FINISH_ONLY_WABA',
          data: { waba_id: 'waba_101' },
        },
      } as MessageEvent;

      const res1 = parseMetaMessageEvent(event1);
      expect(res1?.event).toBe('FINISH_ONLY_WABA');
      expect(res1?.data?.waba_id).toBe('waba_101');

      const event2 = {
        origin: 'https://facebook.com',
        data: {
          type: 'WA_EMBEDDED_SIGNUP',
          event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
          data: { waba_id: 'waba_202', phone_number_id: 'phone_202' },
        },
      } as MessageEvent;

      const res2 = parseMetaMessageEvent(event2);
      expect(res2?.event).toBe('FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING');
      expect(res2?.data?.waba_id).toBe('waba_202');
    });

    it('parses payloads where inner data was serialized as string', () => {
      const event = {
        origin: 'https://www.facebook.com',
        data: {
          type: 'WA_EMBEDDED_SIGNUP',
          event: 'FINISH',
          data: JSON.stringify({ waba_id: 'stringified_waba', phone_number_id: 'stringified_phone' }),
        },
      } as unknown as MessageEvent;

      const res = parseMetaMessageEvent(event);
      expect(res?.data?.waba_id).toBe('stringified_waba');
      expect(res?.data?.phone_number_id).toBe('stringified_phone');
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

    it('passes exact 9e2abab FB.login extras to prevent BSP/TP partner restrictions (regression test)', async () => {
      let passedOptions: unknown = null;
      mockWindow.FB = {
        init: vi.fn(),
        login: vi.fn().mockImplementation((cb: (res: { authResponse?: { code?: string } }) => void, opts: unknown) => {
          passedOptions = opts;
          cb({ authResponse: { code: 'test_code' } });
        }),
      };

      await launchEmbeddedSignup({
        appId: '1123443980045363',
        configId: '29489040784036759',
        onSuccess: vi.fn(),
      });

      expect(passedOptions).toEqual({
        config_id: '29489040784036759',
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: '',
          sessionInfoVersion: '2',
        },
      });

      const extras = (passedOptions as { extras?: Record<string, unknown> })?.extras;
      expect(extras?.feature).toBeUndefined();
      expect(extras?.sessionInfoVersion).toBe('2');
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
            business_id: 'biz_777',
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
        businessId: 'biz_777',
        event: 'FINISH',
      });
    });

    it('successfully calls onSuccess with code when postMessage event does not contain WABA ID', async () => {
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

      // Trigger login callback without any preceding message event
      if (loginCallback) {
        (loginCallback as (res: { authResponse?: { code?: string } }) => void)({
          authResponse: { code: 'code_without_message_ids' },
        });
      }

      expect(onSuccess).toHaveBeenCalledWith({
        code: 'code_without_message_ids',
        phoneNumberId: undefined,
        wabaId: undefined,
        businessId: undefined,
        event: undefined,
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

    it('passes currentStep to onCancel when user cancels during phone selection', async () => {
      let loginCallback: ((res: { authResponse?: { code?: string } | null }) => void) | null = null;

      mockWindow.FB = {
        init: vi.fn(),
        login: vi.fn().mockImplementation((cb: (res: { authResponse?: { code?: string } | null }) => void) => {
          loginCallback = cb;
        }),
      };

      const onCancel = vi.fn();

      await launchEmbeddedSignup({
        appId: 'app_123',
        configId: 'cfg_456',
        onSuccess: vi.fn(),
        onCancel,
      });

      mockWindow.dispatchEvent({
        type: 'message',
        origin: 'https://www.facebook.com',
        data: JSON.stringify({
          type: 'WA_EMBEDDED_SIGNUP',
          event: 'CANCEL',
          data: {
            current_step: 'WABA_PHONE_PROFILE_PICKER',
          },
        }),
      });

      if (loginCallback) {
        (loginCallback as (res: { authResponse?: { code?: string } | null }) => void)({
          authResponse: null,
        });
      }

      expect(onCancel).toHaveBeenCalledWith(
        expect.objectContaining({
          currentStep: 'WABA_PHONE_PROFILE_PICKER',
        })
      );
    });

    it('handles ERROR event from Meta with error details and step', async () => {
      mockWindow.FB = {
        init: vi.fn(),
        login: vi.fn(),
      };

      const onError = vi.fn();

      await launchEmbeddedSignup({
        appId: 'app_123',
        configId: 'cfg_456',
        onSuccess: vi.fn(),
        onError,
      });

      mockWindow.dispatchEvent({
        type: 'message',
        origin: 'https://www.facebook.com',
        data: JSON.stringify({
          type: 'WA_EMBEDDED_SIGNUP',
          event: 'ERROR',
          error_message: 'Unsupported WhatsApp business account type',
          data: {
            current_step: 'WABA_PHONE_PROFILE_PICKER',
          },
        }),
      });

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Unsupported WhatsApp business account type',
        }),
        expect.objectContaining({
          currentStep: 'WABA_PHONE_PROFILE_PICKER',
        })
      );
    });
  });
});
