import { describe, it, expect } from 'vitest'
import { llmConnectSources } from './csp.mjs'

describe('llmConnectSources (LLM connect-src ⇔ assertSafeBaseUrl)', () => {
  it('unpinned → any https host (custom endpoints stay usable)', () => {
    expect(llmConnectSources([])).toEqual(['https:'])
  })

  it('a pinned host admits itself + its subdomains on any port, like hostAllowed()', () => {
    expect(llmConnectSources(['corp.example'])).toEqual(['https://corp.example:*', 'https://*.corp.example:*'])
    expect(llmConnectSources(['llm.a.example', 'api.b.example'])).toHaveLength(4)
  })

  it('an IP literal gets no subdomain wildcard', () => {
    expect(llmConnectSources(['10.0.0.5'])).toEqual(['https://10.0.0.5:*'])
  })

  it('never admits plain http (no http: / http:// source)', () => {
    for (const s of [...llmConnectSources([]), ...llmConnectSources(['corp.example', '10.0.0.5'])]) {
      expect(s.startsWith('http:')).toBe(false)
    }
  })
})
