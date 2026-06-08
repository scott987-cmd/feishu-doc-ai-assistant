import type { AppSettings } from '../types'
import { HAS_BUILTIN_CREDS, FEISHU_API_BASE } from '../config'
import { encryptField, decryptField } from '../crypto'
import { refreshUserAccessToken } from './oauth'

interface CachedToken {
  token: string
  expiresAt: number
}

const tokenCache = new Map<string, CachedToken>()

// ─── User-token bundle (OAuth) with auto-refresh ──────────────────────────────
// The OAuth user_access_token expires in ~2h. We persist it together with its
// refresh_token (encrypted) and renew transparently before expiry, so a long-lived
// side panel never hits a surprise 401 mid-task. Stored in its own storage key
// (not in the visible settings form) so a post-refresh rotation doesn't fight the UI.

const UTOKEN_KEY = '_feishu_utoken_v1'

interface UTokenBundle {
  accessToken: string
  refreshToken?: string
  /** epoch ms; 0 = unknown lifetime (manual paths) → never proactively refreshed */
  expiresAt: number
}

function storageGet(key: string): Promise<unknown> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([key], (r) => resolve(r?.[key]))
    } catch {
      resolve(undefined)
    }
  })
}

function storageSet(key: string, val: unknown): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ [key]: val }, () => resolve())
    } catch {
      resolve()
    }
  })
}

/** Persist the OAuth token bundle (encrypted). Call right after a successful authorize. */
export async function saveUserToken(b: {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
}): Promise<void> {
  if (!b.accessToken) return
  const bundle: UTokenBundle = {
    accessToken: b.accessToken,
    refreshToken: b.refreshToken,
    expiresAt: b.expiresIn ? Date.now() + b.expiresIn * 1000 : 0,
  }
  await storageSet(UTOKEN_KEY, await encryptField(JSON.stringify(bundle)))
}

/** Drop the stored OAuth bundle (e.g. user switched to a manually-pasted token). */
export async function clearUserToken(): Promise<void> {
  await storageSet(UTOKEN_KEY, '')
}

async function loadUserToken(): Promise<UTokenBundle | null> {
  const raw = await storageGet(UTOKEN_KEY)
  if (!raw || typeof raw !== 'string') return null
  try {
    const j = JSON.parse(await decryptField(raw)) as UTokenBundle
    return j?.accessToken ? j : null
  } catch {
    return null
  }
}

/**
 * Return a usable user_access_token, refreshing it via the stored refresh_token when
 * within 5 min of expiry. Prefers the OAuth bundle; falls back to a manually-pasted
 * settings token (which can't be refreshed). Returns null when neither exists.
 */
export async function getValidUserToken(settings: AppSettings): Promise<string | null> {
  const bundle = await loadUserToken()
  if (bundle) {
    const expiringSoon = bundle.expiresAt > 0 && Date.now() > bundle.expiresAt - 5 * 60_000
    if (expiringSoon && bundle.refreshToken) {
      const r = await refreshUserAccessToken(bundle.refreshToken)
      if (r?.accessToken) {
        await saveUserToken(r)
        return r.accessToken
      }
      // refresh failed — return the (likely expired) token; the 401 will surface clearly
    }
    return bundle.accessToken
  }
  return settings.feishuAccessToken?.trim() || null
}

/**
 * Resolve the effective Feishu Bearer token.
 *
 * Priority:
 * SECURITY MODEL — the assistant always acts AS THE USER (user_access_token), never as
 * the broad app/tenant identity. This enforces three principles at once:
 *   1. Anything the assistant creates belongs to the user (not the app account).
 *   3. The assistant can never exceed the user's own permissions — if the user can't
 *      read a document, neither can the assistant (the user token simply gets 403).
 * The tenant token would carry all app scopes and could reach documents the user has no
 * access to, so it is deliberately NOT used as an operating identity.
 */
export async function resolveToken(settings: AppSettings): Promise<string> {
  const userToken = await getValidUserToken(settings)
  if (userToken) return userToken
  throw new Error(
    HAS_BUILTIN_CREDS
      ? '请先用飞书账号一键授权（设置 → 授权）。为保护数据安全，AI 只以你本人的飞书权限操作文档，不会使用应用身份越权访问或创建。'
      : '未配置飞书凭据 — 请在 ⚙️ 设置中用飞书账号授权或填写 user_access_token。'
  )
}

// Feishu error codes meaning the caller lacks permission for the resource (forbidden /
// no edit permission / unauthorized / insufficient OAuth scope). Matched against the
// structured `code=<N>` that feishuReq embeds in the thrown message — precise, unlike
// substring matching which false-positives on unrelated errors that merely contain a digit.
const PERMISSION_CODES = new Set([
  1770032, // Base: forbidden / no permission
  91403,   // Drive: forbidden
  1310213, // Sheets/Docs: no edit permission
  1310214, // Sheets/Docs: unauthorized
  99991672, // OAuth: insufficient scope
  99991679, // OAuth: invalid / insufficient access-token scope
])

/**
 * True when an error means the (user) identity has no permission for the resource — used
 * only to surface a clear "you don't have access" message (the assistant never escalates
 * identity). Primary signal is the structured Feishu error code; the wording fallback is
 * deliberately narrow (no bare "permission"/"denied"/`无.*权限`) to avoid false positives.
 */
export function isPermissionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  const code = msg.match(/code=(\d+)/)
  if (code && PERMISSION_CODES.has(Number(code[1]))) return true
  // No structured code (e.g. an HTTP-level failure) — match precise phrases only.
  return /\bforbidden\b|\bunauthorized\b|permission denied|access denied|no\s+permission|not\s+authorized|无权限|没有权限|无编辑权限|没有编辑权限/i.test(msg)
}

// Feishu error codes meaning the user_access_token is INVALID/EXPIRED (a refresh fixes it,
// unlike a scope/permission error which needs re-auth). Distinct from PERMISSION_CODES.
const TOKEN_EXPIRED_CODES = new Set([99991663, 99991668, 99991661, 99991677, 99991664])

/** True when an error means the access token is invalid/expired (→ refresh + retry). */
export function isTokenExpiredError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  const code = msg.match(/code=(\d+)/)
  if (code && TOKEN_EXPIRED_CODES.has(Number(code[1]))) return true
  return /\b401\b|invalid access token|access token.*(expired|invalid)|token.*(expired|invalid)|登录.*过期|凭证.*(失效|过期)/i.test(msg)
}

/** Force-refresh the OAuth user token NOW (ignoring the proactive expiry window) and persist
 *  the rotated bundle. Returns the new token, or null when there's no refresh_token (manual
 *  paste) or the refresh_token itself is dead (~30d → user must re-authorize). */
export async function forceRefreshUserToken(): Promise<string | null> {
  const bundle = await loadUserToken()
  if (!bundle?.refreshToken) return null
  const r = await refreshUserAccessToken(bundle.refreshToken)
  if (r?.accessToken) { await saveUserToken(r); return r.accessToken }
  return null
}

export async function getTenantAccessToken(appId: string, appSecret: string): Promise<string> {
  const cached = tokenCache.get(appId)
  if (cached && Date.now() < cached.expiresAt - 90_000) return cached.token

  const res = await fetch(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  })
  const json = await res.json() as { code: number; msg: string; tenant_access_token: string; expire: number }

  if (!res.ok || json.code !== 0) {
    throw new Error(`获取 tenant_access_token 失败 (code=${json.code}): ${json.msg}`)
  }

  tokenCache.set(appId, {
    token: json.tenant_access_token,
    expiresAt: Date.now() + json.expire * 1000,
  })
  return json.tenant_access_token
}

export function invalidateToken(appId: string) {
  tokenCache.delete(appId)
}

export function isFeishuConfigured(settings: AppSettings): boolean {
  return HAS_BUILTIN_CREDS || !!settings.feishuAccessToken
}
