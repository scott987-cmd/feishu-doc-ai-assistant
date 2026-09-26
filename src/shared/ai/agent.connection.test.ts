import { describe, it, expect, vi } from 'vitest'
import type { ChatMessage, AppSettings, PageContext } from '../types'
import type { AgentCallbacks } from './agent'

// The model call fails before any response — exactly what the SDK reports as "Connection error."
vi.mock('./llmClient', async () => {
  const { APIConnectionError } = await import('openai')
  return {
    createLlmClient: () => ({
      chat: { completions: { create: () => Promise.reject(new APIConnectionError({ cause: new TypeError('Failed to fetch') })) } },
    }),
  }
})

const { runAgent } = await import('./agent')

describe('runAgent — model connection failure', () => {
  it('surfaces the host + likely causes instead of a bare "Connection error."', async () => {
    const callbacks: AgentCallbacks = {
      onChunk: () => {}, onToolStart: () => {}, onToolEnd: () => {}, onAssistantMessage: () => {}, onToolMessage: () => {},
    }
    const history: ChatMessage[] = [{ id: '1', role: 'user', content: 'hi', createdAt: 0 }]
    const settings = {
      openaiBaseUrl: 'https://api.deepseek.com', openaiApiKey: 'sk-x', openaiModel: 'm', learnFromHistory: false,
    } as AppSettings
    const context = { url: 'https://example.com' } as PageContext

    const err = await runAgent(history, settings, context, callbacks).then(() => null, (e: unknown) => e as Error)
    expect(err?.message).toContain('api.deepseek.com')
    expect(err?.message).toContain('Connection error')
    expect(err?.message).toContain('测试模型连接')
  })
})
