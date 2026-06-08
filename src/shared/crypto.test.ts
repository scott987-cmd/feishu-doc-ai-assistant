import { describe, it, expect, beforeAll, vi } from 'vitest'

// Mock chrome (runtime.id + storage.local) before importing crypto.
const mem: Record<string, unknown> = {}
beforeAll(() => {
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { id: 'test-extension-id-aaaaaaaaaaaaaaaa' },
    storage: {
      local: {
        get: (keys: string[], cb: (r: Record<string, unknown>) => void) => {
          const r: Record<string, unknown> = {}
          for (const k of keys) if (k in mem) r[k] = mem[k]
          cb(r)
        },
        set: (items: Record<string, unknown>, cb?: () => void) => { Object.assign(mem, items); cb?.() },
      },
    },
  }
})

const { encryptField, decryptField } = await import('./crypto')

describe('crypto — AES-256-GCM field encryption', () => {
  it('round-trips a secret (encrypt → decrypt)', async () => {
    const secret = 'u-abc123_user_access_token_测试'
    const enc = await encryptField(secret)
    expect(enc).not.toBe(secret) // actually encrypted
    expect(await decryptField(enc)).toBe(secret)
  })

  it('produces different ciphertext each time (random IV)', async () => {
    const a = await encryptField('same')
    const b = await encryptField('same')
    expect(a).not.toBe(b)
    expect(await decryptField(a)).toBe('same')
    expect(await decryptField(b)).toBe('same')
  })

  it('handles empty string', async () => {
    expect(await decryptField(await encryptField(''))).toBe('')
  })

  it('decrypting garbage does not throw (returns empty/best-effort)', async () => {
    const out = await decryptField('not-valid-base64-cipher!!!')
    expect(typeof out).toBe('string')
  })

  // Regression: concurrent first-time encrypts (e.g. saveSettings' Promise.all over
  // token + apiKey) must NOT generate two different device seeds. If they do, the field
  // encrypted under the seed that doesn't get persisted can't be decrypted on reload —
  // the "LLM key disappears when opening a new page" bug.
  it('concurrent first-time encrypts share ONE device seed (no race)', async () => {
    vi.resetModules()
    const freshMem: Record<string, unknown> = {} // empty store → forces seed generation
    ;(globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { id: 'test-extension-id-aaaaaaaaaaaaaaaa' },
      storage: {
        local: {
          get: (keys: string[], cb: (r: Record<string, unknown>) => void) => {
            const r: Record<string, unknown> = {}
            for (const k of keys) if (k in freshMem) r[k] = freshMem[k]
            cb(r)
          },
          // Delayed write widens the race window the old code had.
          set: (items: Record<string, unknown>, cb?: () => void) =>
            setTimeout(() => { Object.assign(freshMem, items); cb?.() }, 0),
        },
      },
    }
    const fresh = await import('./crypto') // fresh instance: vi.resetModules() cleared the cache above
    const [encToken, encKey] = await Promise.all([
      fresh.encryptField('user_access_token_value'),
      fresh.encryptField('sk-llm-api-key-value'),
    ])
    // Both must decrypt under the single persisted seed.
    expect(await fresh.decryptField(encToken)).toBe('user_access_token_value')
    expect(await fresh.decryptField(encKey)).toBe('sk-llm-api-key-value')
  })
})
