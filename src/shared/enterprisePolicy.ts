import type { AppSettings } from './types'
import { BUILD_CONFIG, HAS_ENTERPRISE_POLICY } from './config'
import { getValidUserToken } from './feishu/auth'
import { getEffectiveAppId } from './feishu/managedAppId'
import { encryptField, decryptField } from './crypto'
import { storageGet, storageSet } from './storage'

/** Central policy pushed by the enterprise proxy. null fields = "not set, leave to the user". */
export interface EnterprisePolicy {
  autoConfirm?: boolean | null
  learnFromHistory?: boolean | null
  notice?: string
}

/** Fail-CLOSED default used before the real policy is known on a policy build: never auto-confirm
 *  destructive deletes until the proxy says it's allowed (a proxy outage must not loosen safety). */
export const FAILCLOSED_POLICY: EnterprisePolicy = { autoConfirm: false }

const KEY = '_enterprise_policy_v1'
let mem: EnterprisePolicy | null = null

/** Fetch the central policy from the proxy (tenant-verified, same as the LLM config). Caches it. */
export async function fetchPolicy(settings: AppSettings): Promise<EnterprisePolicy | null> {
  if (!HAS_ENTERPRISE_POLICY) return null
  const token = await getValidUserToken(settings)
  if (!token) return null
  try {
    const res = await fetch(BUILD_CONFIG.oauthProxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(BUILD_CONFIG.oauthProxyKey ? { 'X-Proxy-Key': BUILD_CONFIG.oauthProxyKey } : {}) },
      body: JSON.stringify({ grant_type: 'policy', user_access_token: token, client_id: await getEffectiveAppId() }),
    })
    const j = (await res.json().catch(() => ({}))) as { policy?: Record<string, unknown> }
    if (!res.ok || !j.policy) return null
    const p = j.policy
    const pol: EnterprisePolicy = {
      autoConfirm: p.auto_confirm as boolean | null,
      learnFromHistory: p.learn_from_history as boolean | null,
      notice: (p.notice as string) || '',
    }
    mem = pol
    try { await storageSet(KEY, await encryptField(JSON.stringify(pol))) } catch { /* best-effort */ }
    return pol
  } catch { return null }
}

/** Last-known policy (memory → encrypted storage). Used by the UI to lock toggles synchronously-ish. */
export async function loadPolicy(): Promise<EnterprisePolicy | null> {
  if (!HAS_ENTERPRISE_POLICY) return null
  if (mem) return mem
  const raw = await storageGet(KEY)
  if (typeof raw !== 'string' || !raw) return null
  try { mem = JSON.parse(await decryptField(raw)) as EnterprisePolicy; return mem } catch { return null }
}

/** Force the policy's non-null fields over a settings object (enterprise wins; user can't override). */
export function applyPolicy(settings: AppSettings, pol: EnterprisePolicy | null): AppSettings {
  if (!pol) return settings
  const out = { ...settings }
  if (pol.autoConfirm != null) out.autoConfirm = pol.autoConfirm
  if (pol.learnFromHistory != null) out.learnFromHistory = pol.learnFromHistory
  return out
}

/** Which settings keys the policy locks (for disabling their toggles in the UI). */
export function policyLockedKeys(pol: EnterprisePolicy | null): Set<keyof AppSettings> {
  const s = new Set<keyof AppSettings>()
  if (pol?.autoConfirm != null) s.add('autoConfirm')
  if (pol?.learnFromHistory != null) s.add('learnFromHistory')
  return s
}
