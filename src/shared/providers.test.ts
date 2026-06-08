import { describe, it, expect } from 'vitest'
import { LLM_PROVIDERS, DEFAULT_PROVIDER, providerForBaseUrl, assertSafeBaseUrl } from './providers'

describe('LLM providers', () => {
  it('defaults to a Chinese model (DeepSeek)', () => {
    expect(DEFAULT_PROVIDER.id).toBe('deepseek')
    expect(DEFAULT_PROVIDER.region).toBe('cn')
    expect(DEFAULT_PROVIDER.models[0]).toBe('deepseek-v4-pro')
  })

  it('lists Chinese providers before overseas ones', () => {
    const firstIntl = LLM_PROVIDERS.findIndex((p) => p.region === 'intl')
    const lastCn = LLM_PROVIDERS.map((p) => p.region).lastIndexOf('cn')
    expect(lastCn).toBeLessThan(firstIntl) // all cn come before the first intl
  })

  it('matches a known base URL back to its provider', () => {
    expect(providerForBaseUrl('https://api.deepseek.com').id).toBe('deepseek')
    expect(providerForBaseUrl('https://open.bigmodel.cn/api/paas/v4').id).toBe('glm')
  })

  it('falls back to the custom provider for an unknown base URL', () => {
    const p = providerForBaseUrl('https://my-own-llm.example.com/v1')
    expect(p.region).toBe('custom')
  })
})

describe('assertSafeBaseUrl — endpoint exfil guard (M2)', () => {
  it('accepts a valid https provider URL and normalizes a trailing slash', () => {
    expect(assertSafeBaseUrl('https://api.deepseek.com/')).toBe('https://api.deepseek.com')
    expect(assertSafeBaseUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1')
  })

  it('rejects empty and unparseable URLs', () => {
    expect(() => assertSafeBaseUrl('')).toThrow(/未配置/)
    expect(() => assertSafeBaseUrl('not a url')).toThrow(/无效/)
  })

  it('rejects non-https (plaintext exfil) except localhost', () => {
    expect(() => assertSafeBaseUrl('http://evil.example.com/v1')).toThrow(/https/)
    expect(assertSafeBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1')
    expect(assertSafeBaseUrl('http://127.0.0.1:1234')).toBe('http://127.0.0.1:1234')
  })

  it('with no enterprise allowlist, any https host is allowed (custom endpoint stays open)', () => {
    expect(assertSafeBaseUrl('https://my-own-llm.example.com/v1', [])).toBe('https://my-own-llm.example.com/v1')
  })

  it('with an enterprise allowlist, restricts to listed hosts (+ subdomains)', () => {
    const allow = ['deepseek.com', 'api.openai.com']
    expect(assertSafeBaseUrl('https://api.deepseek.com/v1', allow)).toBe('https://api.deepseek.com/v1') // subdomain
    expect(assertSafeBaseUrl('https://api.openai.com/v1', allow)).toBe('https://api.openai.com/v1')     // exact
    expect(() => assertSafeBaseUrl('https://exfil.evil.com/v1', allow)).toThrow(/企业策略|不在允许/)
  })
})
