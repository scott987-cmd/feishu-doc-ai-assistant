import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AppSettings } from '../types'

// Built-in creds so refreshUserAccessToken is allowed to call the token endpoint.
vi.mock('../config', () => ({
  BUILD_CONFIG: { feishuAppId: 'cli_x', feishuAppSecret: 'sec', feishuOauthScope: '', oauthProxyUrl: '', feishuBaseDomain: 'feishu.cn' },
  HAS_BUILTIN_CREDS: true,
  HAS_APP_SECRET: true,
  FEISHU_API_BASE: 'https://open.feishu.cn/open-apis',
  FEISHU_AUTHORIZE_URL: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
  FEISHU_HOST_PATTERN: '*.feishu.cn',
  OAUTH_PROXY_HOST: '',
  isFeishuOutboundAllowed: () => true,
}))

// In-memory chrome.storage + identity for crypto + token bundle persistence.
const mem: Record<string, unknown> = {}
;(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: { id: 'test-ext-id-bbbbbbbbbbbbbbbb' },
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

const { saveUserToken, getValidUserToken, clearUserToken, resolveToken, isPermissionError } = await import('./auth')

const SETTINGS = { feishuAccessToken: '' } as AppSettings

beforeEach(async () => {
  vi.restoreAllMocks()
  for (const k of Object.keys(mem)) if (k !== '_device_seed') delete mem[k]
})

describe('getValidUserToken — auto-refresh of OAuth user token', () => {
  it('returns the stored token when it is not near expiry (no network)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await saveUserToken({ accessToken: 'u-fresh', refreshToken: 'r-1', expiresIn: 7200 })
    expect(await getValidUserToken(SETTINGS)).toBe('u-fresh')
    expect(fetchMock).not.toHaveBeenCalled() // far from expiry → no refresh
  })

  it('refreshes via refresh_token when within 5 min of expiry, persists the rotated token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ access_token: 'u-new', refresh_token: 'r-2', expires_in: 7200 }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await saveUserToken({ accessToken: 'u-old', refreshToken: 'r-1', expiresIn: 60 }) // expires in 60s → soon

    expect(await getValidUserToken(SETTINGS)).toBe('u-new')
    expect(fetchMock).toHaveBeenCalledOnce()
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.grant_type).toBe('refresh_token')
    expect(body.refresh_token).toBe('r-1')

    // rotated token + new expiry are persisted → next call uses u-new without refetching
    fetchMock.mockClear()
    expect(await getValidUserToken(SETTINGS)).toBe('u-new')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to the (expired) token when refresh fails — never throws', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ error: 'invalid_grant' }) })
    vi.stubGlobal('fetch', fetchMock)
    await saveUserToken({ accessToken: 'u-stale', refreshToken: 'r-bad', expiresIn: 10 })
    expect(await getValidUserToken(SETTINGS)).toBe('u-stale')
  })

  it('uses a manually-pasted settings token when no OAuth bundle is stored', async () => {
    await clearUserToken()
    expect(await getValidUserToken({ feishuAccessToken: '  u-manual  ' } as AppSettings)).toBe('u-manual')
  })

  it('returns null when neither a bundle nor a manual token exists', async () => {
    await clearUserToken()
    expect(await getValidUserToken(SETTINGS)).toBeNull()
  })
})

describe('resolveToken — operates strictly as the user (principles 1 & 3)', () => {
  it('returns the user token, never the app/tenant identity', async () => {
    vi.stubGlobal('fetch', vi.fn()) // must NOT be called for tenant
    await saveUserToken({ accessToken: 'u-acting', refreshToken: 'r', expiresIn: 7200 })
    expect(await resolveToken(SETTINGS)).toBe('u-acting')
  })

  it('refuses (does not fall back to tenant) when the user has not authorized', async () => {
    await clearUserToken()
    // HAS_BUILTIN_CREDS is mocked true, yet we must NOT mint a tenant token.
    await expect(resolveToken(SETTINGS)).rejects.toThrow(/授权|user_access_token/)
  })
})

describe('isPermissionError — tightened, code-driven (M1)', () => {
  const e = (m: string) => new Error(m)

  it('matches the real thrown format via the structured error code', () => {
    expect(isPermissionError(e('Feishu API error (code=1770032): Forbidden'))).toBe(true)
    expect(isPermissionError(e('Feishu API error (code=91403): no permission'))).toBe(true)
    expect(isPermissionError(e('Feishu API error (code=1310213): xxx'))).toBe(true)
    expect(isPermissionError(e('Feishu API error (code=99991679): scope'))).toBe(true)
  })

  it('does NOT treat unrelated error codes as permission errors', () => {
    expect(isPermissionError(e('Feishu API error (code=1254045): FieldNameNotFound'))).toBe(false)
    expect(isPermissionError(e('Feishu API error (code=1310213000): not a real code'))).toBe(false) // exact code, no substring
    expect(isPermissionError(e('网络请求失败（已重试 3 次）'))).toBe(false)
  })

  it('no longer false-positives on loose wording (the old 无.*权限 / bare permission)', () => {
    expect(isPermissionError(e('无法连接，请检查网络权限设置后重试'))).toBe(false) // old regex matched this
    expect(isPermissionError(e('the file uses permission-based layout'))).toBe(false)
  })

  it('still catches precise permission phrases when there is no structured code', () => {
    expect(isPermissionError(e('403 Forbidden'))).toBe(true)
    expect(isPermissionError(e('Unauthorized'))).toBe(true)
    expect(isPermissionError(e('该账号无编辑权限'))).toBe(true)
  })
})
