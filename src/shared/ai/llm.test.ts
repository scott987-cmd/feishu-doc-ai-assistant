import { describe, it, expect, vi, afterEach } from 'vitest'
import { chatComplete, chatCompleteStream } from './llm'
import { DEFAULT_SETTINGS } from '../types'

const settings = { ...DEFAULT_SETTINGS, openaiBaseUrl: 'https://api.example.com/v1', openaiApiKey: 'sk', openaiModel: 'm' }

afterEach(() => { vi.unstubAllGlobals() })

describe('chatComplete / chatCompleteStream — transport failures', () => {
  it('a fetch that never gets a response names the host + causes instead of "Failed to fetch"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(chatComplete(settings, 'hi')).rejects.toThrow(/api\.example\.com[\s\S]*Base URL[\s\S]*测试模型连接/)
    await expect(chatCompleteStream(settings, 'hi')).rejects.toThrow(/api\.example\.com/)
  })

  it('a stream cut mid-way is explained too', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"半"}}]}\n'))
        c.error(new TypeError('network error'))
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })))
    await expect(chatCompleteStream(settings, 'hi')).rejects.toThrow(/api\.example\.com[\s\S]*中途断开/)
  })

  it('a user cancel stays an AbortError (panels show「已取消」, not an error)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('The user aborted a request.', 'AbortError') }))
    await expect(chatCompleteStream(settings, 'hi')).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('HTTP errors keep their status text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"message":"Insufficient Balance"}}', { status: 402 })))
    await expect(chatComplete(settings, 'hi')).rejects.toThrow(/402[\s\S]*Insufficient Balance/)
  })
})
