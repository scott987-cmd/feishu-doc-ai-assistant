/**
 * AES-256-GCM encryption for chrome.storage values.
 *
 * Key derivation: PBKDF2(chrome.runtime.id + ":" + deviceSeed, SALT, 100k, SHA-256)
 *
 * Two-factor key material:
 *   - chrome.runtime.id  : ties key to this specific extension (public, but necessary)
 *   - deviceSeed         : 32-byte random value generated once per install, stored in
 *                          chrome.storage.local under "_device_seed". Makes the derived
 *                          key unique per device even when the extension ID is publicly known.
 *
 * Migration: existing installs encrypted with the old key (runtime.id only) are detected
 * via the "_device_seed" key's absence. On first load the new seed is generated and settings
 * are re-encrypted on next save — no data loss.
 *
 * THREAT MODEL (be honest): the deviceSeed lives in chrome.storage.local next to the ciphertext,
 * so this is NOT protection against local malware / a profile dump that can read chrome.storage
 * (such an attacker recovers the seed and decrypts). It DOES defend against: casual inspection,
 * other extensions/origins without storage access, and shipping plaintext tokens. For the App
 * Secret we additionally support a PASSWORD-encrypted form (appSecret.ts) that is not derivable
 * from local state. Don't over-claim "encrypted at rest" beyond this.
 */

const SALT = 'feishu-ai-ext-storage-v2'
const SALT_LEGACY = 'feishu-ai-ext-storage-v1'
let _keyPromise: Promise<CryptoKey> | null = null
let _legacyKey: CryptoKey | null = null
let _seedPromise: Promise<string> | null = null

// ─── Per-device seed ──────────────────────────────────────────────────────────

// Cache the in-flight promise so concurrent first-time callers share ONE seed. Without
// this, two parallel encrypt/decrypt calls (e.g. Promise.all in saveSettings) each see no
// seed, generate DIFFERENT seeds, and the last write wins — leaving one field encrypted
// under a seed that's no longer persisted, so it can't be decrypted on the next load
// (symptom: the saved LLM key "disappears" after reopening the panel).
function getDeviceSeed(): Promise<string> {
  if (_seedPromise) return _seedPromise
  _seedPromise = new Promise((resolve) => {
    chrome.storage.local.get(['_device_seed'], (r) => {
      if (r._device_seed) {
        resolve(r._device_seed as string)
      } else {
        const seed = Array.from(crypto.getRandomValues(new Uint8Array(32)))
          .map(b => b.toString(16).padStart(2, '0')).join('')
        chrome.storage.local.set({ _device_seed: seed }, () => resolve(seed))
      }
    })
  })
  return _seedPromise
}

// ─── Key derivation ───────────────────────────────────────────────────────────

async function deriveKey(material: string, salt: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(material),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100_000, hash: 'SHA-256' },
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

function getKey(): Promise<CryptoKey> {
  // Single shared derivation — concurrent callers await the same key (and the same seed),
  // so no two encryptions ever use mismatched device seeds.
  if (_keyPromise) return _keyPromise
  _keyPromise = (async () => {
    const deviceSeed = await getDeviceSeed()
    return deriveKey(`${chrome.runtime.id}:${deviceSeed}`, SALT)
  })()
  return _keyPromise
}

async function getLegacyKey(): Promise<CryptoKey> {
  if (_legacyKey) return _legacyKey
  _legacyKey = await deriveKey(chrome.runtime.id, SALT_LEGACY)
  return _legacyKey
}

// ─── Encrypt / Decrypt ────────────────────────────────────────────────────────

/** Returns base64(iv[12] ‖ ciphertext) or '' for empty input. */
export async function encryptField(plain: string): Promise<string> {
  if (!plain) return ''
  const key = await getKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plain)
  )
  const buf = new Uint8Array(12 + cipher.byteLength)
  buf.set(iv)
  buf.set(new Uint8Array(cipher), 12)
  return btoa(String.fromCharCode(...buf))
}

/**
 * Returns plaintext.
 * Tries current key first; falls back to legacy key (v1, runtime.id only) for
 * migration of settings saved before the device-seed upgrade.
 * Returns '' if both fail (corrupted or pre-encryption plaintext).
 */
export async function decryptField(b64: string): Promise<string> {
  if (!b64) return ''
  let buf: Uint8Array
  try {
    buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  } catch {
    return '' // corrupted / non-base64 storage value — don't throw on load
  }
  const iv = buf.slice(0, 12)
  const data = buf.slice(12)

  // Try current key
  try {
    const key = await getKey()
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
    return new TextDecoder().decode(plain)
  } catch { /* fall through to legacy */ }

  // Try legacy key (v1) — auto-migrates on next save
  try {
    const legacy = await getLegacyKey()
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, legacy, data)
    return new TextDecoder().decode(plain)
  } catch { /* corrupted or old plaintext */ }

  return ''
}
