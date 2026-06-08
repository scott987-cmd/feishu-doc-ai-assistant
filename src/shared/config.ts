/**
 * Build-time constants injected by Vite from .env.local.
 * These are string-replaced in the compiled bundle — not stored at runtime.
 */
export const BUILD_CONFIG = {
  /** internal config revision */
  _rev: 'c0a73d',
  feishuAppId:     (import.meta.env.VITE_FEISHU_APP_ID     ?? '') as string,
  feishuAppSecret: (import.meta.env.VITE_FEISHU_APP_SECRET ?? '') as string,
  /** Password-encrypted App Secret (personal mode). base64(salt‖iv‖ciphertext), produced
   *  by scripts/encrypt-secret.mjs. The plaintext secret is NOT in the bundle — only this
   *  ciphertext; a user password (PBKDF2→AES-GCM) decrypts it at runtime to enable OAuth. */
  appSecretEnc:    (import.meta.env.VITE_FEISHU_APP_SECRET_ENC ?? '').trim() as string,
  /** Max tool calls per conversation turn before the agent stops and asks the user to
   *  confirm continuing (a safety checkpoint against runaway loops / mass operations).
   *  Default 30; set VITE_MAX_TOOL_CALLS to tune (clamped 1–100). */
  maxToolCalls: (() => {
    const n = parseInt((import.meta.env.VITE_MAX_TOOL_CALLS ?? '') as string, 10)
    return Number.isFinite(n) && n > 0 ? Math.min(n, 100) : 30
  })(),
  /** Space-separated OAuth scopes (must be enabled on the app). Empty = identity only. */
  feishuOauthScope: (import.meta.env.VITE_FEISHU_OAUTH_SCOPE ?? '') as string,
  allowedCidrs:    (import.meta.env.VITE_ALLOWED_CIDRS     ?? '')
    .split(',').map((s: string) => s.trim()).filter(Boolean) as string[],
  /** Optional enterprise pin: comma-separated hostnames the LLM endpoint may point at.
   *  When set, the OpenAI base URL is restricted to these hosts (data-exfil guard for
   *  managed deploys). Empty = no host restriction, only the https/validity check. */
  openaiAllowedHosts: (import.meta.env.VITE_OPENAI_ALLOWED_HOSTS ?? '')
    .split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean) as string[],
  /** Optional OAuth proxy base URL. When set, the user-token code-exchange + refresh go
   *  through it so the client_secret never ships in the bundle (enterprise / private
   *  deploys). Empty = direct flow using the baked-in secret (personal use). */
  oauthProxyUrl: (import.meta.env.VITE_OAUTH_PROXY_URL ?? '').trim() as string,
  /** Optional shared key sent as `X-Proxy-Key` to the OAuth proxy. Anti-abuse only (it ships in
   *  the bundle, so it's NOT a strong secret) — real access control is IP allowlist / intranet+SSO
   *  in front of the proxy. Empty = don't send the header. */
  oauthProxyKey: (import.meta.env.VITE_OAUTH_PROXY_KEY ?? '').trim() as string,
  /** Enterprise: fetch the LLM config (base URL + API key + model) from the OAuth proxy instead of
   *  shipping/asking it per-user — the proxy only hands it to verified members of your Feishu tenant,
   *  so the company key never lives in the bundle. Personal builds leave this off (users self-config). */
  llmFromProxy: (import.meta.env.VITE_LLM_FROM_PROXY ?? '') === '1',
  /** Enterprise hardening: forbid the per-user "switch to manual LLM" override — lock to the managed
   *  (proxy) config. Default off = the switch is offered (enterprise CAN still configure manually). */
  llmLockManaged: (import.meta.env.VITE_LLM_LOCK_MANAGED ?? '') === '1',
  /** Enterprise hardening: keep the managed LLM config in MEMORY only — never write it to
   *  chrome.storage (re-fetched from the proxy each cold start). Lowers at-rest key exposure. */
  llmNoPersist: (import.meta.env.VITE_LLM_NO_PERSIST ?? '') === '1',
  /** Enterprise: pull a central policy (force-off clip / auto-confirm, etc.) from the proxy and lock
   *  those toggles. Requires a proxy. */
  enterprisePolicy: (import.meta.env.VITE_ENTERPRISE_POLICY ?? '') === '1',
  /** Redact likely-sensitive values (CN phone / email / ID / bank card) from data BEFORE it's sent
   *  to the LLM. Only affects the copy sent to the model — never the source Feishu data. */
  llmRedact: (import.meta.env.VITE_LLM_REDACT ?? '') === '1',
  /** Hard cap (chars) on a single data payload embedded in an LLM prompt. 0 = no extra cap. */
  llmMaxPayloadChars: Number(import.meta.env.VITE_LLM_MAX_PAYLOAD_CHARS ?? '') || 0,
  /** Feishu BASE DOMAIN. Public SaaS = feishu.cn. A private (on-prem) deployment only
   *  differs by this suffix: set it to e.g. `test.com` and every host derives from it —
   *  open-platform = open.test.com, accounts = accounts.test.com, tenant pages live at
   *  <tenant>.test.com. All API paths & call styles are identical across deployments. */
  feishuBaseDomain: ((import.meta.env.VITE_FEISHU_BASE_DOMAIN ?? 'feishu.cn') as string)
    .trim().toLowerCase().replace(/^\.+|\.+$/g, '').replace(/^https?:\/\//, ''),
  /** Web Clipper: capture the active tab's content (selection / readable text) into a
   *  Feishu Base. Gesture-gated + activeTab only (no new host_permissions, no new egress —
   *  see SECURITY_AUDIT). Default on; set VITE_CLIP_ENABLED=false to ship without it. */
  clipEnabled: ((import.meta.env.VITE_CLIP_ENABLED ?? 'true') as string).trim().toLowerCase() !== 'false',
  /** Optional enterprise governance (v2 — flag defined now, enforcement deferred):
   *  comma-separated domains where clipping is allowed. Empty = allow anywhere. */
  clipManagedDomains: (import.meta.env.VITE_CLIP_MANAGED_DOMAINS ?? '')
    .split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean) as string[],
} as const

/** True when an App ID is configured AND we can mint a user token — a baked-in secret
 *  (direct), a password-encrypted secret (direct, after unlock), or an OAuth proxy. */
export const HAS_BUILTIN_CREDS =
  !!(BUILD_CONFIG.feishuAppId &&
    (BUILD_CONFIG.feishuAppSecret || BUILD_CONFIG.appSecretEnc || BUILD_CONFIG.oauthProxyUrl))

/** True when a PLAINTEXT client_secret is baked in (direct OAuth, no password/proxy). */
export const HAS_APP_SECRET = !!BUILD_CONFIG.feishuAppSecret

/** True when the App Secret ships ENCRYPTED and needs a password to unlock at runtime. */
export const HAS_ENCRYPTED_SECRET = !!BUILD_CONFIG.appSecretEnc && !BUILD_CONFIG.feishuAppSecret

/** True when CIDR allowlist was configured */
export const HAS_NETWORK_RESTRICTION = BUILD_CONFIG.allowedCidrs.length > 0

/** Enterprise managed-LLM mode is available (build opted in AND a proxy is configured to serve it). */
export const HAS_MANAGED_LLM = BUILD_CONFIG.llmFromProxy && !!BUILD_CONFIG.oauthProxyUrl

/** Enterprise central policy is available (build opted in AND a proxy is configured to serve it). */
export const HAS_ENTERPRISE_POLICY = BUILD_CONFIG.enterprisePolicy && !!BUILD_CONFIG.oauthProxyUrl

/** Web Clipper feature flag (see BUILD_CONFIG.clipEnabled). */
export const CLIP_ENABLED = BUILD_CONFIG.clipEnabled

/** Web Speech API (webkitSpeechRecognition) routes audio through Google's servers, which
 *  breaks the "only Feishu + LLM / pure-intranet" posture. So it's only offered on the
 *  default public build — a private domain or a pinned LLM host disables voice input. */
export const WEB_SPEECH_ALLOWED =
  BUILD_CONFIG.feishuBaseDomain === 'feishu.cn' && BUILD_CONFIG.openaiAllowedHosts.length === 0

/** A private / on-prem Feishu deploy (base domain ≠ public SaaS). Its API versions may lag
 *  behind SaaS, so the request layer probes older `/<svc>/vN/` paths when a newer one 404s. */
export const IS_PRIVATE_DEPLOY = BUILD_CONFIG.feishuBaseDomain !== 'feishu.cn'

// ─── Derived Feishu endpoints (all derived from the one base domain) ───────────
/** https://open.<domain>/open-apis — base for all OpenAPI calls. */
export const FEISHU_API_BASE = `https://open.${BUILD_CONFIG.feishuBaseDomain}/open-apis`
/** OAuth authorize (consent) page URL — on accounts.<domain>. */
export const FEISHU_AUTHORIZE_URL = `https://accounts.${BUILD_CONFIG.feishuBaseDomain}/open-apis/authen/v1/authorize`

/** CSP / host_permissions match pattern covering every Feishu subdomain (open, accounts,
 *  the tenant pages, etc.) — all live under the one base domain. e.g. `*.feishu.cn`. */
export const FEISHU_HOST_PATTERN = `*.${BUILD_CONFIG.feishuBaseDomain}`

/** Optional OAuth proxy hostname (may sit on a different domain than Feishu). */
export const OAUTH_PROXY_HOST: string = (() => {
  if (!BUILD_CONFIG.oauthProxyUrl) return ''
  try { return new URL(BUILD_CONFIG.oauthProxyUrl).hostname.toLowerCase() } catch { return '' }
})()

/** Code-layer outbound guard for the FEISHU group: true only when the URL targets a
 *  subdomain of the configured base domain (open/accounts/tenant…) or the OAuth proxy.
 *  The assistant only ever reaches two endpoint groups — Feishu (this) and the LLM
 *  (guarded separately by assertSafeBaseUrl / openaiAllowedHosts). */
export function isFeishuOutboundAllowed(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    const d = BUILD_CONFIG.feishuBaseDomain
    if (host === d || host.endsWith('.' + d)) return true
    return !!OAUTH_PROXY_HOST && host === OAUTH_PROXY_HOST
  } catch {
    return false
  }
}
