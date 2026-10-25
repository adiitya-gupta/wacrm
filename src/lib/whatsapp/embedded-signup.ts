/**
 * Client-side Meta Facebook JavaScript SDK loader and WhatsApp Embedded Signup handler.
 */

export interface EmbeddedSignupSessionData {
  phone_number_id?: string;
  waba_id?: string;
  current_step?: string;
}

export interface EmbeddedSignupMessage {
  type: 'WA_EMBEDDED_SIGNUP';
  event: 'FINISH' | 'CANCEL' | 'ERROR';
  data?: EmbeddedSignupSessionData;
  error_message?: string;
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
            featureType?: string;
            sessionInfoVersion?: string;
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
 * Validate and parse a window message event from Meta Embedded Signup.
 */
export function parseMetaMessageEvent(event: MessageEvent): EmbeddedSignupMessage | null {
  // Validate origin: must come from facebook.com
  const origin = event.origin || '';
  if (!origin.endsWith('.facebook.com') && origin !== 'https://www.facebook.com') {
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

  if (data && data.type === 'WA_EMBEDDED_SIGNUP') {
    return {
      type: 'WA_EMBEDDED_SIGNUP',
      event: data.event,
      data: data.data,
      error_message: data.error_message,
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
  }) => void;
  onCancel?: () => void;
  onError?: (error: Error) => void;
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
  let flowFinished = false;

  const messageHandler = (event: MessageEvent) => {
    const metaMsg = parseMetaMessageEvent(event);
    if (!metaMsg) return;

    if (metaMsg.event === 'FINISH') {
      flowFinished = true;
      if (metaMsg.data?.waba_id) {
        sessionWabaId = String(metaMsg.data.waba_id);
      }
      if (metaMsg.data?.phone_number_id) {
        sessionPhoneNumberId = String(metaMsg.data.phone_number_id);
      }
    } else if (metaMsg.event === 'CANCEL') {
      onCancel?.();
    } else if (metaMsg.event === 'ERROR') {
      onError?.(new Error(metaMsg.error_message || 'Meta Embedded Signup encountered an error'));
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
          });
        } else {
          // If the popup was closed without an authorization code
          if (!flowFinished) {
            onCancel?.();
          }
        }
        cleanup();
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
