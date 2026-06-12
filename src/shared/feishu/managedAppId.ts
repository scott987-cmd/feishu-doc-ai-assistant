/**
 * Enterprise MANAGED App ID — fetch the Feishu App ID from the OAuth proxy instead of baking it into
 * the build. So a single enterprise build (only the proxy URL baked) serves any tenant, and the App
 * ID can rotate server-side without a rebuild.
 *
 * Why this is safe to fetch unauthenticated: the App ID (`cli_xxx`) is PUBLIC — it appears in every
 * OAuth authorize URL the extension generates. The App SECRET stays server-side (token exchange) as
 * before. The proxy still gates this behind X-Proxy-Key / origin / IP / rate-limit middleware.
 *
 * The App ID is needed BEFORE OAuth (to build the authorize URL), so this endpoint must NOT require a
 * user token (which only exists post-OAuth). Cached in memory + plain chrome.storage (public value).
 */
import { BUILD_CONFIG, HAS_MANAGED_APP_ID } from '../config'
import { storageGet, storageSet } from '../storage'
import { getUserAppId } from './userAppCreds'

const CACHE_KEY = '_managed_app_id_v1'
let mem = '' // in-memory cache for this SW/page session
let inflight: Promise<string> | null = null // collapse concurrent cold fetches into one

async function fetchManagedAppId(): Promise<string> {
  const res = await fetch(BUILD_CONFIG.oauthProxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(BUILD_CONFIG.oauthProxyKey ? { 'X-Proxy-Key': BUILD_CONFIG.oauthProxyKey } : {}) },
    body: JSON.stringify({ grant_type: 'app_config' }),
  })
  const j = (await res.json().catch(() => ({}))) as { app_id?: string; error?: string }
  const id = (j.app_id || '').trim()
  if (!res.ok || !id) throw new Error('获取企业 App ID 失败：请确认企业代理已配置 App ID 且网络可达。')
  mem = id
  try { await storageSet(CACHE_KEY, id) } catch { /* cache is best-effort */ }
  return id
}

/** The proxy-provided App ID, cached. '' if not a managed-App-ID build, or on failure. */
export async function getManagedAppId(): Promise<string> {
  if (!HAS_MANAGED_APP_ID) return ''
  if (mem) return mem
  const cached = await storageGet(CACHE_KEY)
  if (typeof cached === 'string' && cached) { mem = cached; return mem }
  try {
    if (!inflight) inflight = fetchManagedAppId().finally(() => { inflight = null })
    return await inflight
  } catch { return '' }
}

/** Forget the cached managed App ID — call after a rotation or to force a re-fetch. */
export async function clearManagedAppIdCache(): Promise<void> { mem = ''; inflight = null; await storageSet(CACHE_KEY, '') }

/** The App ID to use, in precedence order: the build-baked one → the enterprise one served by the
 *  proxy (managed-App-ID build) → the one the user entered in Settings (store "bring your own app").
 *  Lives here (not in oauth.ts) so the LLM/policy clients can resolve client_id without importing the
 *  heavy OAuth module. */
export async function getEffectiveAppId(): Promise<string> {
  if (BUILD_CONFIG.feishuAppId) return BUILD_CONFIG.feishuAppId
  if (HAS_MANAGED_APP_ID) { const id = await getManagedAppId(); if (id) return id }
  return await getUserAppId()
}
