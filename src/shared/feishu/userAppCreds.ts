/**
 * User-provided Feishu app credentials (App ID + Secret) — for the PUBLIC / store build that
 * ships NO baked credentials. The user registers their own Feishu app and enters its App ID +
 * Secret in Settings; the secret is stored DEVICE-ENCRYPTED (crypto.ts), never in plaintext and
 * never in the bundle. Direct-mode OAuth (oauth.ts / appSecret.ts) falls back to these when the
 * build has no built-in App Secret.
 */
import { storageGet, storageSet } from '../storage'
import { encryptField, decryptField } from '../crypto'

const KEY = '_user_app_creds_v1'

interface Stored { appId: string; secretEnc: string }

// In-memory cache so the hot OAuth path doesn't re-read/decrypt on every token call.
let _cache: { appId: string; secret: string | null } | null = null

async function load(): Promise<Stored | null> {
  const v = await storageGet(KEY)
  if (v && typeof v === 'object' && typeof (v as Stored).appId === 'string') return v as Stored
  return null
}

/** Persist the user's App ID (plain) + App Secret (device-encrypted). */
export async function saveUserAppCreds(appId: string, secret: string): Promise<void> {
  const id = appId.trim()
  const sec = secret.trim()
  await storageSet(KEY, { appId: id, secretEnc: sec ? await encryptField(sec) : '' })
  _cache = { appId: id, secret: sec || null }
}

export async function getUserAppId(): Promise<string> {
  if (_cache) return _cache.appId
  return (await load())?.appId ?? ''
}

export async function getUserAppSecret(): Promise<string | null> {
  if (_cache?.secret) return _cache.secret
  const v = await load()
  if (v?.secretEnc) {
    const dec = await decryptField(v.secretEnc)
    if (dec) { _cache = { appId: v.appId, secret: dec }; return dec }
  }
  return null
}

/** True once the user has saved BOTH an App ID and an App Secret. */
export async function hasUserAppCreds(): Promise<boolean> {
  const v = await load()
  return !!(v && v.appId && v.secretEnc)
}

export async function clearUserAppCreds(): Promise<void> {
  await storageSet(KEY, null)
  _cache = null
}
