import { describe, it, expect, beforeEach } from 'vitest'

// In-memory chrome.storage + runtime id (crypto.ts derives a device key from runtime.id).
const mem: Record<string, unknown> = {}
;(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: { id: 'test-ext-id-cccccccccccccccc' },
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

const { saveUserAppCreds, getUserAppId, getUserAppSecret, hasUserAppCreds, clearUserAppCreds } =
  await import('./userAppCreds')

beforeEach(async () => {
  for (const k of Object.keys(mem)) if (k !== '_device_seed') delete mem[k]
  await clearUserAppCreds()
})

describe('userAppCreds — bring-your-own Feishu app credentials', () => {
  it('round-trips App ID + Secret', async () => {
    await saveUserAppCreds('cli_abc123', 's3cr3t-value')
    expect(await getUserAppId()).toBe('cli_abc123')
    expect(await getUserAppSecret()).toBe('s3cr3t-value')
    expect(await hasUserAppCreds()).toBe(true)
  })

  it('stores the secret ENCRYPTED, never plaintext', async () => {
    await saveUserAppCreds('cli_abc123', 's3cr3t-value')
    const raw = JSON.stringify(mem['_user_app_creds_v1'])
    expect(raw).not.toContain('s3cr3t-value') // ciphertext only
    expect(raw).toContain('cli_abc123')       // App ID is not secret
  })

  it('hasUserAppCreds is false with only an App ID (no secret)', async () => {
    await saveUserAppCreds('cli_only_id', '')
    expect(await getUserAppId()).toBe('cli_only_id')
    expect(await hasUserAppCreds()).toBe(false)
  })

  it('clear() wipes both id and secret', async () => {
    await saveUserAppCreds('cli_abc', 'sec')
    await clearUserAppCreds()
    expect(await getUserAppId()).toBe('')
    expect(await hasUserAppCreds()).toBe(false)
  })

  it('trims whitespace from pasted values', async () => {
    await saveUserAppCreds('  cli_trim  ', '  sec-trim \n')
    expect(await getUserAppId()).toBe('cli_trim')
    expect(await getUserAppSecret()).toBe('sec-trim')
  })
})
