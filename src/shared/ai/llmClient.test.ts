import { describe, it, expect } from 'vitest'
import { createLlmClient } from './llmClient'

// Headers a browser never lists in a CORS preflight: Accept is safelisted, Content-Length is a
// forbidden request header (the browser sets it itself and ignores ours).
const NOT_PREFLIGHTED = new Set(['accept', 'content-length'])

function capture() {
  const seen: Array<{ url: string; headers: Record<string, string> }> = []
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) } })
    return new Response(JSON.stringify({
      id: 'c', object: 'chat.completion', created: 0, model: 'm',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'pong' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { seen, fetchImpl }
}

describe('createLlmClient', () => {
  it('sends only authorization + content-type as preflighted headers (no SDK telemetry)', async () => {
    const { seen, fetchImpl } = capture()
    const client = createLlmClient('https://api.example.com/v1', 'sk-test', fetchImpl)
    const resp = await client.chat.completions.create({ model: 'm', messages: [{ role: 'user', content: 'ping' }] })

    expect(resp.choices[0].message.content).toBe('pong')
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toBe('https://api.example.com/v1/chat/completions')
    const names = Object.keys(seen[0].headers).map((h) => h.toLowerCase())
    expect(names.filter((h) => h.startsWith('x-stainless'))).toEqual([])
    expect(names).not.toContain('user-agent')
    expect(names.filter((h) => !NOT_PREFLIGHTED.has(h)).sort()).toEqual(['authorization', 'content-type'])
    expect(seen[0].headers.authorization).toBe('Bearer sk-test')
  })
})
