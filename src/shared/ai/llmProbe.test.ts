import { describe, it, expect } from 'vitest'
import { probeLlm } from './llmProbe'

const cfg = { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test', model: 'm-1' }
type Call = { url: string; init: RequestInit }

/** A fetch double: `chat` answers the chat request, `noCors` the reachability probe. */
function fake(chat: (init: RequestInit) => Promise<Response>, noCors: () => Promise<Response> = async () => new Response(null)) {
  const calls: Call[] = []
  const fetchImpl = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    return init.mode === 'no-cors' ? noCors() : chat(init)
  }) as typeof fetch
  return { calls, fetchImpl }
}
const netFail = async (): Promise<Response> => { throw new TypeError('Failed to fetch') }

describe('probeLlm', () => {
  it('reports the guard / missing-field problem without any request', async () => {
    const { calls, fetchImpl } = fake(async () => new Response(''))
    expect((await probeLlm({ ...cfg, baseUrl: 'http://evil.example.com' }, { fetchImpl })).msg).toMatch(/https/)
    expect((await probeLlm({ ...cfg, apiKey: ' ' }, { fetchImpl })).msg).toMatch(/API Key/)
    expect((await probeLlm({ ...cfg, model: '' }, { fetchImpl })).msg).toMatch(/模型/)
    expect(calls).toHaveLength(0)
  })

  it('ok: one streamed chat request with only the auth + JSON headers, cut off after the status line', async () => {
    const { calls, fetchImpl } = fake(async () => new Response('data: {}\n\n', { status: 200 }))
    const r = await probeLlm(cfg, { fetchImpl })
    expect(r).toEqual({ ok: true, msg: expect.stringContaining('api.example.com') })
    expect(r.msg).toContain('m-1')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.example.com/v1/chat/completions')
    expect(Object.keys(calls[0].init.headers as object).sort()).toEqual(['Authorization', 'Content-Type'])
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ model: 'm-1', stream: true })
    expect(calls[0].init.signal?.aborted).toBe(true) // generation stopped, no tokens wasted
  })

  it('maps HTTP errors to a hint + the provider’s own message', async () => {
    const body = JSON.stringify({ error: { message: 'Authentication Fails, Your api key is invalid' } })
    const r401 = await probeLlm(cfg, fake(async () => new Response(body, { status: 401 })))
    expect(r401.ok).toBe(false)
    expect(r401.msg).toMatch(/API Key 无效[\s\S]*401[\s\S]*Authentication Fails/)

    const r404 = await probeLlm(cfg, fake(async () => new Response('Not Found', { status: 404 })))
    expect(r404.msg).toMatch(/\/v1[\s\S]*模型名[\s\S]*404[\s\S]*Not Found/)

    expect((await probeLlm(cfg, fake(async () => new Response('', { status: 402 })))).msg).toMatch(/余额不足/)
  })

  it('network failure but the host answers a no-cors request → a CORS refusal', async () => {
    const { calls, fetchImpl } = fake(netFail, async () => new Response(null))
    const r = await probeLlm(cfg, { fetchImpl })
    expect(r.ok).toBe(false)
    expect(r.msg).toMatch(/能连上 api\.example\.com[\s\S]*CORS/)
    expect(calls[1].init.mode).toBe('no-cors')
  })

  it('network failure and no answer at all → the unreachable checklist', async () => {
    const r = await probeLlm(cfg, fake(netFail, netFail))
    expect(r.msg).toMatch(/连不上 api\.example\.com[\s\S]*域名[\s\S]*防火墙/)
  })

  it('no response within the timeout → says so', async () => {
    const hang = (init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })
    const r = await probeLlm(cfg, { ...fake(hang), timeoutMs: 20 })
    expect(r.msg).toMatch(/超时/)
  })
})
