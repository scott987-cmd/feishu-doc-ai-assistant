import { describe, it, expect, vi, beforeEach } from 'vitest'

// Enterprise managed-LLM build: proxy configured, not locked.
vi.mock('../config', () => ({
  HAS_MANAGED_LLM: true,
  BUILD_CONFIG: { oauthProxyUrl: 'https://proxy.test/', oauthProxyKey: '', feishuAppId: 'cli_x', llmLockManaged: false },
}))
vi.mock('../feishu/auth', () => ({ getValidUserToken: vi.fn(async () => 'utok') }))
vi.mock('../crypto', () => ({ encryptField: async (s: string) => s, decryptField: async (s: string) => s }))

import { usingManagedLlm, resolveLlmConfig, clearManagedLlmCache } from './llmConfig'
import type { AppSettings } from '../types'

const store: Record<string, unknown> = {}
const settings = (over?: Partial<AppSettings>): AppSettings =>
  ({ openaiBaseUrl: 'http://manual', openaiApiKey: 'mk', openaiModel: 'mm', ...over } as AppSettings)

beforeEach(async () => {
  for (const k of Object.keys(store)) delete store[k]
  vi.stubGlobal('chrome', { storage: { local: {
    get: (keys: string[], cb: (r: Record<string, unknown>) => void) =>
      cb(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((k) => [k, store[k]]))),
    set: (obj: Record<string, unknown>, cb?: () => void) => { Object.assign(store, obj); cb?.() },
  } } })
  await clearManagedLlmCache()
})

describe('llmConfig — 企业托管 vs 个人手动', () => {
  it('usingManagedLlm: 默认托管，切到 manual 即手动', () => {
    expect(usingManagedLlm(settings())).toBe(true)
    expect(usingManagedLlm(settings({ llmSource: 'manual' }))).toBe(false)
  })

  it('手动模式 → 使用用户自己的设置', async () => {
    const cfg = await resolveLlmConfig(settings({ llmSource: 'manual' }))
    expect(cfg).toEqual({ baseUrl: 'http://manual', apiKey: 'mk', model: 'mm' })
  })

  it('托管模式 → 用用户 token 向代理换取企业配置并缓存', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ base_url: 'http://co', api_key: 'cok', model: 'com' }) }))
    vi.stubGlobal('fetch', fetchMock)
    const cfg = await resolveLlmConfig(settings())
    expect(cfg).toEqual({ baseUrl: 'http://co', apiKey: 'cok', model: 'com' })
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)
    expect(body).toMatchObject({ grant_type: 'llm_config', user_access_token: 'utok' }) // 证明身份的是用户自己的 token
    await resolveLlmConfig(settings())            // 第二次走缓存
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('代理拒绝（非本企业）→ 抛出明确错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'not_in_tenant' }) })))
    await expect(resolveLlmConfig(settings())).rejects.toThrow(/不属于本企业/)
  })
})
