/**
 * LLM provider presets for the OpenAI-compatible API field. Chinese providers are
 * listed first and DeepSeek is the default — overseas providers (OpenAI/etc.) remain
 * selectable but are never the default. Picking a provider fills in its base URL and
 * model list; "自定义" leaves both free-form for any other OpenAI-compatible endpoint.
 */
export interface LlmProvider {
  id: string
  name: string
  baseUrl: string
  models: string[]
  region: 'cn' | 'intl' | 'custom'
}

export const LLM_PROVIDERS: LlmProvider[] = [
  // Model lists are autocomplete suggestions only (the Model field is free-text);
  // refreshed 2026-05. DeepSeek's come straight from its /models API.
  {
    id: 'deepseek',
    name: 'DeepSeek 深度求索',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    region: 'cn',
  },
  {
    id: 'qwen',
    name: '通义千问 Qwen（阿里云）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen3.7-max', 'qwen3.6-plus', 'qwen3.6-flash'],
    region: 'cn',
  },
  {
    id: 'glm',
    name: '智谱 GLM（清华智谱）',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-5.1', 'glm-4.6'],
    region: 'cn',
  },
  {
    id: 'moonshot',
    name: 'Kimi（月之暗面 Moonshot）',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k2.6', 'kimi-k2.5'],
    region: 'cn',
  },
  {
    id: 'openai',
    name: 'OpenAI（海外）',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini'],
    region: 'intl',
  },
  {
    id: 'custom',
    name: '自定义（任意 OpenAI 兼容接口）',
    baseUrl: '',
    models: [],
    region: 'custom',
  },
]

/** Default provider — DeepSeek (a Chinese model), used by DEFAULT_SETTINGS. */
export const DEFAULT_PROVIDER = LLM_PROVIDERS[0]

/** Match a base URL back to a known provider (falls back to the custom entry). */
export function providerForBaseUrl(baseUrl: string): LlmProvider {
  return (
    LLM_PROVIDERS.find((p) => p.region !== 'custom' && p.baseUrl === baseUrl) ??
    LLM_PROVIDERS[LLM_PROVIDERS.length - 1]
  )
}

/** Hostname of every built-in provider — the "known good" set for the Settings soft warning. */
export const KNOWN_PROVIDER_HOSTS: string[] = LLM_PROVIDERS
  .filter((p) => p.baseUrl)
  .map((p) => { try { return new URL(p.baseUrl).hostname.toLowerCase() } catch { return '' } })
  .filter(Boolean)

function isLocalhost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
}

/** host matches an allowlist entry exactly or as a subdomain (api.foo.com ⊂ foo.com). */
function hostAllowed(host: string, allowed: string[]): boolean {
  return allowed.some((a) => host === a || host.endsWith('.' + a))
}

/**
 * Validate the LLM endpoint before any conversation is sent to it — guards against a
 * mistyped / tampered base URL silently exfiltrating chat + table content.
 *
 * - Rejects empty / unparseable URLs.
 * - Requires https:// (http only allowed for localhost dev / a local proxy).
 * - When `allowedHosts` is non-empty (enterprise pin), the host must be in it; otherwise
 *   any https host is permitted (the "custom OpenAI-compatible endpoint" feature stays open).
 *
 * Returns the normalized origin+path on success; throws Error on rejection.
 */
export function assertSafeBaseUrl(baseUrl: string, allowedHosts: string[] = []): string {
  const raw = (baseUrl ?? '').trim()
  if (!raw) throw new Error('未配置模型 API 地址（Base URL）——请在设置中填写。')

  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new Error(`模型 API 地址无效：「${raw}」。请填写完整的 https:// 地址。`)
  }

  const host = u.hostname.toLowerCase()
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocalhost(host))) {
    throw new Error(`出于数据安全，模型 API 必须使用 https://（当前为 ${u.protocol}//${host}）。`)
  }

  if (allowedHosts.length > 0 && !hostAllowed(host, allowedHosts) && !isLocalhost(host)) {
    throw new Error(
      `企业策略限制：模型 API 主机「${host}」不在允许列表内，已阻止以防数据外泄。` +
      `允许的主机：${allowedHosts.join('、')}。`
    )
  }
  return u.origin + u.pathname.replace(/\/$/, '')
}
