/**
 * Client-side Meta Facebook JavaScript SDK loader and WhatsApp Embedded Signup handler.
 */

export interface EmbeddedSignupSessionData {
  phone_number_id?: string;
  waba_id?: string;
  business_id?: string;
  current_step?: string;
}

export interface EmbeddedSignupMessage {
  type: 'WA_EMBEDDED_SIGNUP';
  event: 'FINISH' | 'FINISH_ONLY_WABA' | 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' | 'CANCEL' | 'ERROR' | (string & {});
  data?: EmbeddedSignupSessionData;
  error_message?: string;
  rawPayload?: unknown;
}

declare global {
  interface Window {
    fbAsyncInit?: () => void;
    FB?: {
      init: (options: {
        appId: string;
        autoLogAppEvents?: boolean;
        xfbml?: boolean;
        version: string;
      }) => void;
      login: (
        callback: (response: {
          authResponse?: {
            code?: string;
            accessToken?: string;
            userID?: string;
            expiresIn?: number;
          };
          status?: string;
        }) => void,
        options: {
          config_id: string;
          response_type: string;
          override_default_response_type?: boolean;
          extras?: {
            setup?: Record<string, unknown>;
            feature?: string;
            featureType?: string;
            sessionInfoVersion?: string | number;
            version?: string | number;
          };
        }
      ) => void;
    };
  }
}

let sdkLoadingPromise: Promise<boolean> | null = null;

/**
 * Loads and initializes the Meta Facebook JavaScript SDK.
 */
export function loadFacebookSdk(appId: string): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);

  if (window.FB) {
    return Promise.resolve(true);
  }

  if (sdkLoadingPromise) {
    return sdkLoadingPromise;
  }

  sdkLoadingPromise = new Promise<boolean>((resolve) => {
    window.fbAsyncInit = function () {
      try {
        window.FB?.init({
          appId,
          autoLogAppEvents: true,
          xfbml: false,
          version: 'v21.0',
        });
        resolve(true);
      } catch (err) {
        console.error('[Facebook SDK] Init failed:', err);
        resolve(false);
      }
    };

    const existingScript = document.getElementById('facebook-jssdk');
    if (existingScript) {
      if (window.FB) resolve(true);
      return;
    }

    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => {
      console.error('[Facebook SDK] Failed to load SDK script');
      resolve(false);
    };

    document.head.appendChild(script);
  });

  return sdkLoadingPromise;
}

/**
 * Validates whether an incoming window message origin is an authorized Meta domain.
 * Supports facebook.com, web.facebook.com, and any *.facebook.com subdomains over HTTPS.
 */
export function isAllowedMetaOrigin(origin: string): boolean {
  if (!origin || typeof origin !== 'string') return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'facebook.com' || host.endsWith('.facebook.com');
  } catch {
    return false;
  }
}

/**
 * Safely extracts WABA ID, Phone Number ID, and Business ID across all Meta Embedded Signup
 * payload schemas (sessionInfoVersion 2, 3, flat, nested under data.data, camelCase, snake_case).
 */
export function extractEmbeddedSignupData(payload: unknown): {
  wabaId?: string;
  phoneNumberId?: string;
  businessId?: string;
  currentStep?: string;
} {
  if (!payload || typeof payload !== 'object') return {};

  const p = payload as Record<string, unknown>;
  const candidates: Array<Record<string, unknown>> = [];

  if (p.data && typeof p.data === 'object') {
    const sub = p.data as Record<string, unknown>;
    if (sub.data && typeof sub.data === 'object') {
      candidates.push(sub.data as Record<string, unknown>);
    }
    candidates.push(sub);
  }
  candidates.push(p);

  let wabaId: string | undefined;
  let phoneNumberId: string | undefined;
  let businessId: string | undefined;
  let currentStep: string | undefined;

  for (const obj of candidates) {
    if (!wabaId) {
      const val =
        obj.waba_id ??
        obj.wabaId ??
        obj.whatsapp_business_account_id ??
        obj.messaging_account_id;
      if (val !== undefined && val !== null && String(val).trim()) {
        wabaId = String(val).trim();
      }
    }
    if (!phoneNumberId) {
      const val = obj.phone_number_id ?? obj.phoneNumberId ?? obj.phone_number;
      if (val !== undefined && val !== null && String(val).trim()) {
        phoneNumberId = String(val).trim();
      }
    }
    if (!businessId) {
      const val = obj.business_id ?? obj.businessId ?? obj.owner_business_id;
      if (val !== undefined && val !== null && String(val).trim()) {
        businessId = String(val).trim();
      }
    }
    if (!currentStep) {
      const val = obj.current_step ?? obj.currentStep;
      if (val !== undefined && val !== null && String(val).trim()) {
        currentStep = String(val).trim();
      }
    }
  }

  return { wabaId, phoneNumberId, businessId, currentStep };
}

/**
 * Validate and parse a window message event from Meta Embedded Signup.
 */
export function parseMetaMessageEvent(event: MessageEvent): EmbeddedSignupMessage | null {
  if (!isAllowedMetaOrigin(event.origin || '')) {
    return null;
  }

  let data = event.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }

  if (!data || typeof data !== 'object') {
    return null;
  }

  const payload = data as Record<string, unknown>;

  // Handle case where inner payload data was stringified
  if (typeof payload.data === 'string') {
    try {
      payload.data = JSON.parse(payload.data);
    } catch {
      // Keep as is
    }
  }

  const type = payload.type;
  const eventName = typeof payload.event === 'string' ? payload.event : '';

  if (type === 'WA_EMBEDDED_SIGNUP' || (!type && /^(FINISH|CANCEL|ERROR)/.test(eventName))) {
    const extracted = extractEmbeddedSignupData(payload);
    return {
      type: 'WA_EMBEDDED_SIGNUP',
      event: (eventName as EmbeddedSignupMessage['event']) || 'FINISH',
      data: {
        phone_number_id: extracted.phoneNumberId,
        waba_id: extracted.wabaId,
        business_id: extracted.businessId,
        current_step: extracted.currentStep,
      },
      error_message: typeof payload.error_message === 'string' ? payload.error_message : undefined,
      rawPayload: payload,
    };
  }

  return null;
}

export interface LaunchEmbeddedSignupOptions {
  appId: string;
  configId: string;
  onSuccess: (result: {
    code: string;
    wabaId?: string;
    phoneNumberId?: string;
    businessId?: string;
    event?: string;
  }) => void;
  onCancel?: (details?: { currentStep?: string; rawData?: unknown }) => void;
  onError?: (error: Error, details?: { currentStep?: string; rawData?: unknown }) => void;
}

/**
 * Launch the Meta WhatsApp Embedded Signup popup flow.
 * Returns a cleanup function that detaches the message listener.
 */
export async function launchEmbeddedSignup(
  options: LaunchEmbeddedSignupOptions
): Promise<() => void> {
  const { appId, configId, onSuccess, onCancel, onError } = options;

  let sessionWabaId: string | undefined;
  let sessionPhoneNumberId: string | undefined;
  let sessionBusinessId: string | undefined;
  let lastCurrentStep: string | undefined;
  let lastEvent: string | undefined;
  let flowFinished = false;

  const messageHandler = (event: MessageEvent) => {
    const metaMsg = parseMetaMessageEvent(event);
    if (!metaMsg) return;

    if (metaMsg.data?.current_step) {
      lastCurrentStep = metaMsg.data.current_step;
    }

    if (typeof metaMsg.event === 'string' && metaMsg.event.startsWith('FINISH')) {
      flowFinished = true;
      lastEvent = metaMsg.event;
      if (metaMsg.data?.waba_id) {
        sessionWabaId = String(metaMsg.data.waba_id);
      }
      if (metaMsg.data?.phone_number_id) {
        sessionPhoneNumberId = String(metaMsg.data.phone_number_id);
      }
      if (metaMsg.data?.business_id) {
        sessionBusinessId = String(metaMsg.data.business_id);
      }
    } else if (metaMsg.event === 'CANCEL') {
      const step = metaMsg.data?.current_step || lastCurrentStep;
      onCancel?.({ currentStep: step, rawData: metaMsg.rawPayload });
    } else if (metaMsg.event === 'ERROR') {
      const step = metaMsg.data?.current_step || lastCurrentStep;
      onError?.(
        new Error(metaMsg.error_message || 'Meta Embedded Signup encountered an error'),
        { currentStep: step, rawData: metaMsg.rawPayload }
      );
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('message', messageHandler);
  }

  const cleanup = () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('message', messageHandler);
    }
  };

  const loaded = await loadFacebookSdk(appId);
  if (!loaded || !window.FB) {
    cleanup();
    onError?.(new Error('Failed to load Facebook SDK. Please check connection and ad-blockers.'));
    return cleanup;
  }

  try {
    window.FB.login(
      (response) => {
        if (response.authResponse?.code) {
          onSuccess({
            code: response.authResponse.code,
            wabaId: sessionWabaId,
            phoneNumberId: sessionPhoneNumberId,
            businessId: sessionBusinessId,
            event: lastEvent,
          });
        } else {
          // If the popup was closed without an authorization code
          if (!flowFinished) {
            onCancel?.({ currentStep: lastCurrentStep });
          }
        }
        // Delay cleanup slightly so any concurrent or in-flight window postMessage is not dropped
        if (typeof setTimeout !== 'undefined') {
          setTimeout(cleanup, 1000);
        } else {
          cleanup();
        }
      },
      {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: '',
          sessionInfoVersion: '2',
        },
      }
    );
  } catch (err) {
    cleanup();
    onError?.(err instanceof Error ? err : new Error('Failed to open Meta login window'));
  }

  return cleanup;
}
