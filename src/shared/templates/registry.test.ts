// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { fetchRemoteTemplates, clearRegistryCache, sanitizeRemoteTemplate } from './registry'

beforeEach(() => { localStorage.clear(); clearRegistryCache() })
afterEach(() => { vi.restoreAllMocks() })

function mockFetch(routes: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    const body = routes[u]
    if (body === undefined) return { ok: false, status: 404, statusText: 'NF' }
    return { ok: true, json: async () => body }
  }))
}

describe('fetchRemoteTemplates — single-URL bundle', () => {
  it('fetches a bundle (.json with inline templates) in ONE request', async () => {
    mockFetch({
      'http://localhost:8787/registry.json': {
        version: '1', templates: [{ id: 'hr', name: '人事', tables: [{ ref: 't', name: 'T', fields: [] }] }],
      },
    })
    const { templates, error } = await fetchRemoteTemplates('http://localhost:8787/registry.json')
    expect(error).toBeUndefined()
    expect(templates).toHaveLength(1)
    expect(templates[0].source).toBe('remote')
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1) // single request
  })

  it('still supports the index.json + files layout (directory base)', async () => {
    mockFetch({
      'https://x.com/templates/index.json': { version: '1', templates: [{ id: 'hr', file: 'hr.json' }] },
      'https://x.com/templates/hr.json': { id: 'hr', name: '人事', tables: [] },
    })
    const { templates } = await fetchRemoteTemplates('https://x.com/templates')
    expect(templates).toHaveLength(1)
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2) // index + file
  })
})

describe('fetchRemoteTemplates — URL policy', () => {
  it('allows http://localhost for local testing', async () => {
    mockFetch({ 'http://localhost:9000/r.json': { templates: [] } })
    const { error } = await fetchRemoteTemplates('http://localhost:9000/r.json')
    expect(error).toBeUndefined()
  })

  it('rejects other plain-http URLs', async () => {
    const { error } = await fetchRemoteTemplates('http://evil.example.com/r.json')
    expect(error).toMatch(/HTTPS|localhost/)
  })
})

describe('sanitizeRemoteTemplate — schema + cover guard (M3/M4)', () => {
  it('accepts a well-formed template and tags it remote', () => {
    const t = sanitizeRemoteTemplate({ id: 'hr', name: '人事', tables: [] })
    expect(t).not.toBeNull()
    expect(t!.source).toBe('remote')
  })

  it('drops structurally-invalid entries (missing id/name, tables not an array)', () => {
    expect(sanitizeRemoteTemplate(null)).toBeNull()
    expect(sanitizeRemoteTemplate({ name: '无id', tables: [] })).toBeNull()
    expect(sanitizeRemoteTemplate({ id: 'x', tables: [] })).toBeNull()
    expect(sanitizeRemoteTemplate({ id: 'x', name: 'y', tables: 'nope' })).toBeNull()
  })

  it('strips an unsafe cover URL but keeps the template', () => {
    const t = sanitizeRemoteTemplate({ id: 'x', name: 'y', tables: [], cover: 'javascript:alert(1)' })
    expect(t).not.toBeNull()
    expect(t!.cover).toBeUndefined()
  })

  it('keeps a safe https cover', () => {
    const t = sanitizeRemoteTemplate({ id: 'x', name: 'y', tables: [], cover: 'https://cdn/x.png' })
    expect(t!.cover).toBe('https://cdn/x.png')
  })
})
