import { describe, it, expect } from 'vitest'
// The REAL SDK error classes (not a mock): llmFailureKind recognizes them structurally, so an
// SDK upgrade that changes their shape/messages must fail here rather than silently regress.
import { APIConnectionError, APIConnectionTimeoutError, APIUserAbortError, AuthenticationError } from 'openai'
import { llmFailureKind, llmHost, explainLlmError } from './llmError'

const BASE = 'https://api.deepseek.com'

describe('llmFailureKind', () => {
  it('recognizes the SDK connection + timeout errors', () => {
    expect(llmFailureKind(new APIConnectionError({ cause: new TypeError('Failed to fetch') }))).toBe('network')
    expect(llmFailureKind(new APIConnectionTimeoutError())).toBe('timeout')
  })

  it('recognizes a plain fetch() network failure in every engine', () => {
    for (const m of ['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed', 'network error', 'fetch failed']) {
      expect(llmFailureKind(new TypeError(m))).toBe('network')
    }
  })

  it('leaves HTTP status errors, aborts and unrelated errors alone', () => {
    expect(llmFailureKind(new AuthenticationError(401, { message: 'bad key' }, undefined, {}))).toBeNull()
    expect(llmFailureKind(new APIUserAbortError())).toBeNull()
    expect(llmFailureKind(new DOMException('aborted', 'AbortError'))).toBeNull()
    expect(llmFailureKind(new Error('AI 接口错误（401）：invalid key'))).toBeNull()
    expect(llmFailureKind(new TypeError("Cannot read properties of undefined (reading 'choices')"))).toBeNull()
    expect(llmFailureKind('Connection error.')).toBeNull() // not an Error
  })
})

describe('explainLlmError', () => {
  it('rewrites a connection error into an actionable message naming the host, keeping the cause', () => {
    const orig = new APIConnectionError({ cause: new TypeError('Failed to fetch') })
    const e = explainLlmError(orig, 'https://api.deepseek.com/v1') as Error
    expect(e).not.toBe(orig)
    expect(e.message).toContain('api.deepseek.com')
    expect(e.message).toContain('Connection error') // the text users search for stays visible
    expect(e.message).toMatch(/Base URL/)
    expect(e.message).toMatch(/CORS/)
    expect(e.message).toContain('测试模型连接')
    expect(e.cause).toBe(orig)
  })

  it('rewrites a timeout distinctly', () => {
    const e = explainLlmError(new APIConnectionTimeoutError(), BASE) as Error
    expect(e.message).toMatch(/超时/)
    expect(e.message).toContain('api.deepseek.com')
  })

  it('returns anything else untouched (same object)', () => {
    const http = new Error('AI 接口错误（402）：Insufficient Balance')
    const abort = new DOMException('aborted', 'AbortError')
    expect(explainLlmError(http, BASE)).toBe(http)
    expect(explainLlmError(abort, BASE)).toBe(abort)
  })
})

describe('llmHost', () => {
  it('keeps a non-default port and drops the path', () => {
    expect(llmHost('https://dashscope.aliyuncs.com/compatible-mode/v1')).toBe('dashscope.aliyuncs.com')
    expect(llmHost('https://llm.corp.example:8443/v1')).toBe('llm.corp.example:8443')
  })
})
