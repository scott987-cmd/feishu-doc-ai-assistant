import type { AppSettings } from '../types'
import { BUILD_CONFIG, HAS_MANAGED_LLM } from '../config'
import { getValidUserToken } from '../feishu/auth'
import { getEffectiveAppId } from '../feishu/managedAppId'
import { encryptField, decryptField } from '../crypto'
import { storageGet, storageSet } from '../storage'

export interface LlmConfig { baseUrl: string; apiKey: string; model: string }

const CACHE_KEY = '_llm_managed_v1'
let mem: LlmConfig | null = null // in-memory cache for this SW/page session
let inflight: Promise<LlmConfig> | null = null // collapse concurrent cold fetches into one

/**
 * Whether to use the enterprise MANAGED LLM config (fetched from the proxy) for this build+setting.
 * Managed builds default to managed; the user may switch to 'manual' UNLESS the build locks it.
 */
export function usingManagedLlm(settings: AppSettings): boolean {
  if (!HAS_MANAGED_LLM) return false
  if (BUILD_CONFIG.llmLockManaged) return true
  return settings.llmSource !== 'manual'
}

/**
 * Fetch the company LLM config from the proxy. The proxy hands it out ONLY to verified members of
 * your Feishu tenant — we prove membership by sending the user's own user_access_token (the proxy
 * checks it against Feishu). The company key therefore never ships in the .crx.
 */
export async function fetchManagedLlmConfig(settings: AppSettings): Promise<LlmConfig> {
  const token = await getValidUserToken(settings)
  if (!token) throw new Error('请先用飞书账号授权——企业版大模型配置随授权按需下发。')
  const res = await fetch(BUILD_CONFIG.oauthProxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(BUILD_CONFIG.oauthProxyKey ? { 'X-Proxy-Key': BUILD_CONFIG.oauthProxyKey } : {}) },
    body: JSON.stringify({ grant_type: 'llm_config', user_access_token: token, client_id: await getEffectiveAppId() }),
  })
  const j = (await res.json().catch(() => ({}))) as { base_url?: string; api_key?: string; model?: string; error?: string }
  if (!res.ok || !j.base_url || !j.api_key) {
    throw new Error(j.error === 'not_in_tenant'
      ? '你的账号不属于本企业，无法获取大模型配置。'
      : '获取企业大模型配置失败：请确认已用本企业飞书账号授权、且在应用可用范围内。')
  }
  const cfg: LlmConfig = { baseUrl: j.base_url, apiKey: j.api_key, model: j.model || '' }
  mem = cfg
  // Mem-only mode (VITE_LLM_NO_PERSIST): never write the company key to disk — re-fetch next session.
  if (!BUILD_CONFIG.llmNoPersist) {
    try { await storageSet(CACHE_KEY, await encryptField(JSON.stringify(cfg))) } catch { /* cache is best-effort */ }
  }
  return cfg
}

async function loadCachedManaged(): Promise<LlmConfig | null> {
  if (mem) return mem
  if (BUILD_CONFIG.llmNoPersist) return null // mem-only: nothing on disk to load
  const raw = await storageGet(CACHE_KEY)
  if (typeof raw !== 'string' || !raw) return null
  try { mem = JSON.parse(await decryptField(raw)) as LlmConfig; return mem } catch { return null }
}

/**
 * The effective LLM config for a call: the MANAGED (proxy) config in enterprise managed mode,
 * otherwise the user's own Settings. Managed config is cached (memory + device-encrypted storage)
 * and fetched on first use, so the per-user identity check happens once per session.
 */
export async function resolveLlmConfig(settings: AppSettings): Promise<LlmConfig> {
  if (usingManagedLlm(settings)) {
    const cached = await loadCachedManaged()
    if (cached) return cached
    // Dedup: concurrent cold callers (a panel firing viz+report+smartfill at once) share one fetch.
    if (!inflight) inflight = fetchManagedLlmConfig(settings).finally(() => { inflight = null })
    return inflight
  }
  return { baseUrl: settings.openaiBaseUrl, apiKey: settings.openaiApiKey, model: settings.openaiModel }
}

/** Forget the cached managed config — call on an LLM 401 (key rotated) or a manual "refresh". */
export async function clearManagedLlmCache(): Promise<void> { mem = null; inflight = null; await storageSet(CACHE_KEY, '') }
