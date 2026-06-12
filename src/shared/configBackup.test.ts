import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock device crypto to a reversible, deterministic transform so we can assert secret handling
// without WebCrypto in the test env.
vi.mock('./crypto', () => ({
  encryptField: async (s: string) => (s ? `enc(${s})` : ''),
  decryptField: async (s: string) => (s.startsWith('enc(') ? s.slice(4, -1) : s),
}))

import { mergeById, buildBackup, applyBackup } from './configBackup'

// In-memory chrome.storage.local mock supporting get(null) / get([key]) / set.
function mockStorage(seed: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...seed }
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: (keys: unknown, cb: (r: Record<string, unknown>) => void) => {
          if (keys === null || keys === undefined) cb({ ...store })
          else { const ks = Array.isArray(keys) ? keys : [keys]; const o: Record<string, unknown> = {}; for (const k of ks) if (k in store) o[k as string] = store[k as string]; cb(o) }
        },
        set: (items: Record<string, unknown>, cb?: () => void) => { Object.assign(store, items); cb?.() },
      },
    },
  })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  return store
}

describe('mergeById (pure)', () => {
  it('adds only missing ids, newest-first, capped', () => {
    const local = [{ id: 'a', createdAt: 1 }]
    const incoming = [{ id: 'a', createdAt: 9 }, { id: 'b', createdAt: 5 }, { id: 'c', createdAt: 7 }]
    const out = mergeById(local, incoming, 50)
    expect(out.map((x) => x.id)).toEqual(['c', 'b', 'a']) // a kept (not overwritten), b/c added, sorted desc
  })
  it('respects the cap', () => {
    const local: { id: string; createdAt?: number }[] = []
    const incoming = Array.from({ length: 80 }, (_, i) => ({ id: `s${i}`, createdAt: i }))
    expect(mergeById(local, incoming, 50)).toHaveLength(50)
  })
})

describe('buildBackup — secret handling', () => {
  beforeEach(() => vi.restoreAllMocks())
  it('EXCLUDES secrets by default; includes the data that matters', async () => {
    mockStorage({
      settings_v2: { openaiBaseUrl: 'https://x', openaiModel: 'm', openaiApiKey: 'enc(sk-123)', feishuAccessToken: 'enc(u-tok)' },
      dataviz_v1: [{ id: 'v1', createdAt: 1 }],
      slides_decks_v1: [{ id: 'd1', createdAt: 1 }],
    })
    const f = await buildBackup({ includeSecrets: false, exportedAt: 'T' })
    expect(f._backup).toBe('feishu-ai-assistant')
    expect(f.secretsIncluded).toBe(false)
    const s = f.data.settings as Record<string, unknown>
    expect(s.openaiBaseUrl).toBe('https://x')
    expect(s.openaiApiKey).toBeUndefined()        // secret omitted
    expect(s.feishuAccessToken).toBeUndefined()
    expect((f.data.dataviz as unknown[])).toHaveLength(1)
  })
  it('DECRYPTS secrets to plaintext when opted in', async () => {
    mockStorage({ settings_v2: { openaiApiKey: 'enc(sk-123)', feishuAccessToken: 'enc(u-tok)' } })
    const f = await buildBackup({ includeSecrets: true, exportedAt: 'T' })
    const s = f.data.settings as Record<string, unknown>
    expect(s.openaiApiKey).toBe('sk-123')         // decrypted plaintext in the file
    expect(s.feishuAccessToken).toBe('u-tok')
  })
})

describe('applyBackup — merge restore', () => {
  beforeEach(() => vi.restoreAllMocks())
  it('restores artifacts into an empty store and re-encrypts secrets on this device', async () => {
    const store = mockStorage({}) // fresh/lost device
    const file = {
      _backup: 'feishu-ai-assistant', version: 1, exportedAt: 'T', secretsIncluded: true,
      data: {
        settings: { openaiBaseUrl: 'https://y', openaiApiKey: 'sk-xyz' },
        dataviz: [{ id: 'v1', createdAt: 2 }, { id: 'v2', createdAt: 1 }],
        slides: [{ id: 'd1', createdAt: 1 }],
        recipes: [{ id: 'r1', createdAt: 1 }],
      },
    }
    const sum = await applyBackup(file)
    expect(sum.dataviz).toBe(2)
    expect(sum.slides).toBe(1)
    expect((store['dataviz_v1'] as unknown[])).toHaveLength(2)
    expect((store['settings_v2'] as Record<string, string>).openaiApiKey).toBe('enc(sk-xyz)') // re-encrypted
    expect((store['settings_v2'] as Record<string, string>).openaiBaseUrl).toBe('https://y')
  })
  it('rejects a non-backup file', async () => {
    mockStorage({})
    await expect(applyBackup({ foo: 1 } as never)).rejects.toThrow('不是有效的备份文件')
  })
})
