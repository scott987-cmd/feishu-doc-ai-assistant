import { describe, it, expect } from 'vitest'
import { decryptSecretBlob } from './appSecret'

// Mirror scripts/encrypt-secret.mjs exactly, so this also guards script↔runtime parity.
async function encryptBlob(secret: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const mat = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 210_000, hash: 'SHA-256' },
    mat, { name: 'AES-GCM', length: 256 }, false, ['encrypt'],
  )
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(secret)))
  const out = new Uint8Array(16 + 12 + ct.length)
  out.set(salt, 0); out.set(iv, 16); out.set(ct, 28)
  return btoa(String.fromCharCode(...out))
}

describe('decryptSecretBlob — password-unlocked App Secret (personal hardening)', () => {
  it('round-trips with the correct password', async () => {
    const blob = await encryptBlob('cli_secret_abc123', 'S3cure-Pass!')
    expect(await decryptSecretBlob(blob, 'S3cure-Pass!')).toBe('cli_secret_abc123')
  })

  it('rejects a wrong password (GCM auth tag fails → WRONG_PASSWORD)', async () => {
    const blob = await encryptBlob('cli_secret_abc123', 'right-password')
    await expect(decryptSecretBlob(blob, 'wrong-password')).rejects.toThrow(/WRONG_PASSWORD/)
  })

  it('rejects a corrupted blob', async () => {
    await expect(decryptSecretBlob('not-valid-base64-!!!', 'x')).rejects.toThrow()
  })

  it('is whitespace-sensitive — a stray trailing newline fails unless trimmed (unlock trims)', async () => {
    // encrypt-secret.mjs trims the password, so the canonical password has no whitespace.
    const blob = await encryptBlob('cli_x', 'My-Pass-40hex')
    await expect(decryptSecretBlob(blob, 'My-Pass-40hex\n')).rejects.toThrow(/WRONG_PASSWORD/)
    // unlockAppSecret() applies .trim(), so a pasted-with-newline password still unlocks:
    expect(await decryptSecretBlob(blob, 'My-Pass-40hex\n'.trim())).toBe('cli_x')
  })
})
