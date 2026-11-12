import { AiError, type AiUsage, type ChatMessage } from '../types'
import { getT } from '@/lib/i18n/translate'

const t = getT('LibErrors')

// ============================================================
// Bits shared by the OpenAI + Anthropic adapters.
// ============================================================

export interface ProviderArgs {
  apiKey: string
  model: string
  systemPrompt: string
  messages: ChatMessage[]
  timeoutMs: number
  /** Custom OpenAI-compatible base URL; omitted for native providers. */
  baseUrl?: string | null
}

/**
 * Coerce a provider's usage block into our normalized `AiUsage`, tolerant
 * of missing/partial fields (providers differ and older API versions may
 * omit counts). Returns null when there's nothing usable, so logging can
 * distinguish "no usage reported" from "zero tokens". `total` falls back
 * to prompt + completion when the provider doesn't send it (Anthropic).
 */
export function normalizeUsage(raw: {
  prompt?: unknown
  completion?: unknown
  total?: unknown
}): AiUsage | null {
  const num = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0
  const promptTokens = num(raw.prompt)
  const completionTokens = num(raw.completion)
  const total = num(raw.total)
  const totalTokens = total > 0 ? total : promptTokens + completionTokens
  if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0) {
    return null
  }
  return { promptTokens, completionTokens, totalTokens }
}

/** Map a fetch rejection (timeout / DNS / offline) to a typed AiError. */
export function toNetworkError(err: unknown): AiError {
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    return new AiError(t('ai.timeout'), {
      code: 'timeout',
      status: 504,
    })
  }
  const msg = err instanceof Error ? err.message : String(err)
  return new AiError(t('ai.unreachable', { message: msg }), {
    code: 'network_error',
    status: 502,
  })
}

interface ProviderErrorBody {
  error?: { message?: string } | string
  errors?: Array<{ code?: number | string; message?: string }>
  message?: string
}

/** Build a typed AiError from a non-2xx provider response, pulling the
 *  provider's own error message out of OpenAI, Anthropic, or Cloudflare
 *  JSON bodies when present. Never logs or embeds request credentials. */
export async function providerHttpError(
  provider: string,
  res: Response,
): Promise<AiError> {
  let detail = ''
  try {
    const body = (await res.json()) as ProviderErrorBody
    if (typeof body?.error === 'string') {
      detail = body.error
    } else if (body?.error && typeof body.error.message === 'string') {
      detail = body.error.message
    } else if (Array.isArray(body?.errors) && body.errors.length > 0) {
      detail = body.errors
        .map((e) => {
          const msg = typeof e?.message === 'string' ? e.message.trim() : ''
          const code =
            e?.code !== undefined && e?.code !== null ? String(e.code) : ''
          if (msg && code) return `${msg} (code ${code})`
          return msg || (code ? `code ${code}` : '')
        })
        .filter(Boolean)
        .join('; ')
    } else if (typeof body?.message === 'string') {
      detail = body.message
    }
  } catch {
    // Non-JSON error body — try reading a short plain-text snippet if available.
    try {
      if (typeof res.text === 'function') {
        const rawText = (await res.text()).trim()
        if (rawText) detail = rawText.slice(0, 200)
      }
    } catch {
      // Ignore secondary body-read failure.
    }
  }

  const { status } = res
  const code =
    status === 401 || status === 403
      ? 'invalid_key'
      : status === 429
        ? 'rate_limited'
        : 'provider_error'
  const base =
    code === 'invalid_key'
      ? t('ai.invalidKey', { provider })
      : code === 'rate_limited'
        ? t('ai.rateLimited', { provider })
        : t('ai.apiError', { provider, status: String(status) })

  console.warn('[ai provider] HTTP error response', {
    provider,
    status,
    code,
    detail: detail ? detail.slice(0, 200) : null,
  })

  const permissionHint =
    status === 403
      ? 'Verify token permissions (Cloudflare Workers AI requires Workers AI: Read + Edit).'
      : ''
  const parts = [
    code === 'invalid_key' ? `HTTP ${status}` : '',
    detail,
    permissionHint,
  ].filter(Boolean)

  return new AiError(parts.length > 0 ? `${base}: ${parts.join(' — ')}` : base, {
    code,
    // Surface an auth failure as 401 so the settings "Test key" button
    // can show "invalid key"; everything else is an upstream 502.
    status: code === 'invalid_key' ? 401 : 502,
    upstreamStatus: status,
  })
}

/**
 * Collapse consecutive same-role turns into one (joined with blank
 * lines). Anthropic requires strictly alternating roles; merging is
 * also harmless for OpenAI and keeps the transcript compact.
 */
export function mergeConsecutive(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const m of messages) {
    const last = out[out.length - 1]
    if (last && last.role === m.role) {
      last.content = `${last.content}\n\n${m.content}`
    } else {
      out.push({ role: m.role, content: m.content })
    }
  }
  return out
}
