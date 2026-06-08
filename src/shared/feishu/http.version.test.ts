import { describe, it, expect, vi, beforeEach } from 'vitest'

// Force private-deploy mode so feishuFetch enables the /<svc>/vN → v(N-1) fallback.
vi.mock('../config', () => ({
  FEISHU_API_BASE: 'https://open.test.com/open-apis',
  IS_PRIVATE_DEPLOY: true,
  isFeishuOutboundAllowed: () => true,
}))

import { feishuFetch } from './http'
import { _resetVersionCache } from './version'

const urls: string[] = []
/** Mock fetch: for whichever path segment the URL contains, return {status, body}. A 404 body that
 *  is NOT a Feishu envelope = gateway "path absent"; a {code,...} body = a resource error. */
function mockFetch(bySegment: Record<string, { status: number; body?: string }>) {
  urls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(String(url))
    for (const [seg, r] of Object.entries(bySegment)) {
      if (String(url).includes(seg)) {
        const body = r.body ?? (r.status === 200 ? '{"code":0,"msg":"ok","data":{}}' : 'not found')
        return { status: r.status, statusText: '', headers: new Headers(), text: async () => body, json: async () => JSON.parse(body) }
      }
    }
    return { status: 500, statusText: '', headers: new Headers(), text: async () => '{}', json: async () => ({}) }
  }))
}

beforeEach(() => { _resetVersionCache(); vi.restoreAllMocks() })

describe('feishuFetch — 私有化 API 版本动态回退', () => {
  it('/sheets/v3 网关 404 → 自动降到 v2 并成功', async () => {
    mockFetch({ '/sheets/v3/': { status: 404 }, '/sheets/v2/': { status: 200 } })
    const res = await feishuFetch('GET', '/sheets/v3/spreadsheets/x', 'tok')
    expect(res.status).toBe(200)
    expect(urls.some((u) => u.includes('/sheets/v3/'))).toBe(true)
    expect(urls.some((u) => u.includes('/sheets/v2/'))).toBe(true)
  })

  it('记住可用版本 → 下次直达 v2，不再探测已缺失的 v3', async () => {
    mockFetch({ '/sheets/v3/': { status: 404 }, '/sheets/v2/': { status: 200 } })
    await feishuFetch('GET', '/sheets/v3/spreadsheets/x', 'tok')
    mockFetch({ '/sheets/v3/': { status: 404 }, '/sheets/v2/': { status: 200 } })
    const res = await feishuFetch('GET', '/sheets/v3/spreadsheets/y', 'tok')
    expect(res.status).toBe(200)
    expect(urls.some((u) => u.includes('/sheets/v3/'))).toBe(false)
    expect(urls.filter((u) => u.includes('/sheets/v2/')).length).toBe(1)
  })

  it('写操作也安全：网关 404=未执行，照样回退', async () => {
    mockFetch({ '/bitable/v2/': { status: 404 }, '/bitable/v1/': { status: 200 } })
    const res = await feishuFetch('POST', '/bitable/v2/apps/a/tables', 'tok', { table: {} })
    expect(res.status).toBe(200)
    expect(urls.some((u) => u.includes('/bitable/v1/'))).toBe(true)
  })

  it('资源级 404（飞书 {code} 信封）不降级，直接返回该 404', async () => {
    // v2 EXISTS but the record is missing → 404 with a Feishu envelope. Must NOT fall back to v1.
    mockFetch({
      '/bitable/v2/': { status: 404, body: '{"code":1254005,"msg":"record not found"}' },
      '/bitable/v1/': { status: 200 },
    })
    const res = await feishuFetch('GET', '/bitable/v2/apps/a/tables/t/records/r', 'tok')
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe(1254005)                    // surfaces the real resource error
    expect(urls.some((u) => u.includes('/bitable/v1/'))).toBe(false) // never downgraded
    // and it did NOT poison the cache toward v1: a later real call still tries v2 first
    mockFetch({ '/bitable/v2/': { status: 200 } })
    await feishuFetch('GET', '/bitable/v2/apps/a/tables/t/records/s', 'tok')
    expect(urls.some((u) => u.includes('/bitable/v2/'))).toBe(true)
  })

  it('所有版本都网关 404 → 如实返回最低版本的 404', async () => {
    mockFetch({ '/docx/v2/': { status: 404 }, '/docx/v1/': { status: 404 } })
    const res = await feishuFetch('GET', '/docx/v2/documents/x', 'tok')
    expect(res.status).toBe(404)
    expect(urls.some((u) => u.includes('/docx/v1/'))).toBe(true)
  })
})
