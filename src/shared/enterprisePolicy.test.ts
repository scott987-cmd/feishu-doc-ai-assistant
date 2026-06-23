import { describe, it, expect } from 'vitest'

// Keep module import side-effect-free: stub the deps the module imports at top level.
import { vi } from 'vitest'
vi.mock('./config', () => ({ HAS_ENTERPRISE_POLICY: true, BUILD_CONFIG: { oauthProxyUrl: 'https://proxy.test/', oauthProxyKey: '' } }))
vi.mock('./feishu/auth', () => ({ getValidUserToken: vi.fn(async () => 'utok') }))
vi.mock('./feishu/managedAppId', () => ({ getEffectiveAppId: vi.fn(async () => 'cli_x') }))
vi.mock('./crypto', () => ({ encryptField: async (s: string) => s, decryptField: async (s: string) => s }))
vi.mock('./storage', () => ({ storageGet: vi.fn(async () => ''), storageSet: vi.fn(async () => {}) }))

import { FAILCLOSED_POLICY, applyPolicy, policyLockedKeys } from './enterprisePolicy'
import type { AppSettings } from './types'

const base = (over: Partial<AppSettings> = {}): AppSettings =>
  ({ autoConfirm: true, learnFromHistory: true, ...over }) as AppSettings

describe('enterprisePolicy — fail-closed safety invariant', () => {
  it('FAILCLOSED_POLICY never auto-confirms destructive deletes', () => {
    // This is the core enterprise safety promise: a proxy outage must tighten, not loosen.
    expect(FAILCLOSED_POLICY.autoConfirm).toBe(false)
  })
})

describe('enterprisePolicy.applyPolicy', () => {
  it('is identity when there is no policy (user settings untouched)', () => {
    const s = base({ autoConfirm: true })
    expect(applyPolicy(s, null)).toBe(s)
  })

  it('forces non-null policy fields over user settings (enterprise wins)', () => {
    const out = applyPolicy(base({ autoConfirm: true, learnFromHistory: true }), { autoConfirm: false, learnFromHistory: false })
    expect(out.autoConfirm).toBe(false)
    expect(out.learnFromHistory).toBe(false)
  })

  it('leaves null policy fields to the user (does not clobber)', () => {
    const out = applyPolicy(base({ autoConfirm: true, learnFromHistory: true }), { autoConfirm: null, learnFromHistory: undefined as unknown as null })
    expect(out.autoConfirm).toBe(true) // null → not set → user value preserved
    expect(out.learnFromHistory).toBe(true)
  })

  it('does not mutate the input settings object', () => {
    const s = base({ autoConfirm: true })
    applyPolicy(s, { autoConfirm: false })
    expect(s.autoConfirm).toBe(true)
  })
})

describe('enterprisePolicy.policyLockedKeys', () => {
  it('returns exactly the non-null policy keys', () => {
    expect([...policyLockedKeys({ autoConfirm: false })]).toEqual(['autoConfirm'])
    expect(policyLockedKeys({ autoConfirm: false, learnFromHistory: true })).toEqual(new Set(['autoConfirm', 'learnFromHistory']))
  })
  it('locks nothing for a null policy or all-null fields', () => {
    expect(policyLockedKeys(null).size).toBe(0)
    expect(policyLockedKeys({ autoConfirm: null, learnFromHistory: null }).size).toBe(0)
  })
})
