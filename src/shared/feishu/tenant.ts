import { BUILD_CONFIG } from '../config'

/**
 * The tenant origin (e.g. https://<tenant>.feishu.cn) is the prefix every clickable Feishu
 * doc/base/sheet link needs. We learn it from pages the user visits (which carry the tenant
 * subdomain) and reuse it when building links from a non-Feishu context (web clipping). One
 * place owns the storage key + the "is this a real tenant host" rule so all writers/readers agree.
 */
export const TENANT_ORIGIN_KEY = '_feishu_tenant_origin'

/**
 * A host carrying a TENANT subdomain (acme.feishu.cn) — a SUBDOMAIN of the base domain, NOT the
 * bare base domain itself. Links built from the bare base domain don't open (no tenant), so the
 * bare domain must never be treated as, or persisted as, a tenant origin.
 */
export function isTenantHost(urlStr?: string): boolean {
  const d = BUILD_CONFIG.feishuBaseDomain
  try {
    const h = new URL(urlStr ?? '').hostname.toLowerCase()
    return h !== d && h.endsWith('.' + d)
  } catch { return false }
}

/**
 * Persist the tenant origin from a Feishu URL — ONLY when it carries a real tenant subdomain
 * (never the bare base domain, which would poison later clip-generated links). Safe to call from
 * anywhere (content script / side panel / clip); no-ops on non-tenant or unparseable input.
 */
export function rememberTenantOrigin(urlStr?: string): void {
  if (!isTenantHost(urlStr)) return
  try { chrome.storage?.local?.set({ [TENANT_ORIGIN_KEY]: new URL(urlStr as string).origin }) } catch { /* ignore */ }
}
