/**
 * Password-protected App Secret (personal / direct OAuth mode).
 *
 * The bundle ships the secret ENCRYPTED (BUILD_CONFIG.appSecretEnc), never in plaintext,
 * so grepping the .crx yields only ciphertext. At runtime the user enters a password →
 * PBKDF2 → AES-GCM key → decrypt. The GCM auth tag verifies the password (wrong password
 * fails to decrypt). Once unlocked it's cached in memory; "remember on this device" also
 * persists it device-encrypted (crypto.ts) so the password isn't needed again here.
 *
 * This raises the bar substantially over plaintext-in-bundle: an attacker with the public
 * bundle must brute-force the password (PBKDF2, 210k iters) — it is NOT recoverable by
 * inspection. It is still a client secret, so a strong password matters.
 */
import { BUILD_CONFIG } from '../config'
import { encryptField, decryptField } from '../crypto'

const STORE_KEY = '_app_secret_dev_v1'
const PBKDF2_ITERS = 210_000

let _secret: string | null = null // in-memory once unlocked / loaded this session

function b64ToBytes(b64: string) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

async function deriveKey(password: string, salt: BufferSource, usage: KeyUsage): Promise<CryptoKey> {
  const mat = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    mat,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  )
}

/**
 * Decrypt a base64(salt[16]‖iv[12]‖ciphertext) blob with a password. Pure (no storage) so
 * it can be unit-tested. Throws 'WRONG_PASSWORD' when the password/blob don't match.
 */
export async function decryptSecretBlob(blob: string, password: string): Promise<string> {
  const bytes = b64ToBytes(blob.trim())
  const salt = bytes.slice(0, 16)
  const iv = bytes.slice(16, 28)
  const data = bytes.slice(28)
  const key = await deriveKey(password, salt, 'decrypt')
  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
  } catch {
    throw new Error('WRONG_PASSWORD')
  }
  return new TextDecoder().decode(plain)
}

function storageGet(key: string): Promise<unknown> {
  return new Promise((res) => { try { chrome.storage.local.get([key], (r) => res(r?.[key])) } catch { res(undefined) } })
}
function storageSet(key: string, val: unknown): Promise<void> {
  return new Promise((res) => { try { chrome.storage.local.set({ [key]: val }, () => res()) } catch { res() } })
}

/** Decrypt the build-baked secret with the password. On success caches it (memory + —
 *  when remember — device-encrypted storage). Throws on wrong password. */
export async function unlockAppSecret(password: string, remember = true): Promise<void> {
  if (!BUILD_CONFIG.appSecretEnc) throw new Error('本构建未使用加密的应用密钥')
  let secret: string
  try {
    // Trim to match encrypt-secret.mjs (which trims the password before encrypting) —
    // otherwise a pasted password with a stray trailing newline/space won't match.
    secret = await decryptSecretBlob(BUILD_CONFIG.appSecretEnc, password.trim())
  } catch {
    throw new Error('密码错误，无法解锁应用密钥')
  }
  _secret = secret
  await storageSet(STORE_KEY, remember ? await encryptField(secret) : '')
}

/** Forget the unlocked secret (memory + device store). */
export async function lockAppSecret(): Promise<void> {
  _secret = null
  await storageSet(STORE_KEY, '')
}

/**
 * Resolve the client_secret for direct-mode OAuth:
 *   plaintext (legacy build) → in-memory unlock → device-persisted unlock.
 * Returns null when the secret is encrypted but still LOCKED (caller must prompt for the
 * password) or when no secret is configured at all.
 */
export async function getClientSecret(): Promise<string | null> {
  if (BUILD_CONFIG.feishuAppSecret) return BUILD_CONFIG.feishuAppSecret
  if (_secret) return _secret
  if (!BUILD_CONFIG.appSecretEnc) return null
  const stored = await storageGet(STORE_KEY)
  if (typeof stored === 'string' && stored) {
    const dec = await decryptField(stored)
    if (dec) { _secret = dec; return dec }
  }
  return null
}

/** True when an encrypted secret exists but hasn't been unlocked yet (this session/device). */
export async function isAppSecretLocked(): Promise<boolean> {
  if (BUILD_CONFIG.feishuAppSecret || !BUILD_CONFIG.appSecretEnc) return false
  return (await getClientSecret()) === null
}
