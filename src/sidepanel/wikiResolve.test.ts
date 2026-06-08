import { describe, it, expect } from 'vitest'
import type { PageContext } from '../shared/types'
import { mergeResolvedWiki } from './wikiResolve'

const wikiCtx = (wikiToken: string): PageContext => ({
  url: `https://x.feishu.cn/wiki/${wikiToken}`,
  title: '知识库…',
  selectedText: '',
  feishu: { kind: 'wiki', wikiToken, isBase: false },
})

const resolvedDoc: PageContext['feishu'] = { kind: 'doc', isBase: false, documentId: 'doxAbc' }

describe('mergeResolvedWiki — drops stale wiki resolutions (H4)', () => {
  it('applies the resolution when still on the same wiki node', () => {
    const out = mergeResolvedWiki(wikiCtx('W1'), 'W1', resolvedDoc, '季度计划')
    expect(out.feishu).toBe(resolvedDoc)
    expect(out.title).toBe('季度计划')
  })

  it('ignores a resolution for a wiki the panel has already left (different token)', () => {
    const current = wikiCtx('W2') // user moved on to W2
    const out = mergeResolvedWiki(current, 'W1', resolvedDoc) // W1 resolves late
    expect(out).toBe(current) // unchanged — W2 context preserved
  })

  it('ignores a resolution once the context is no longer a wiki', () => {
    const current: PageContext = { url: 'u', title: 't', selectedText: '', feishu: { kind: 'base', isBase: true, appToken: 'bas' } }
    const out = mergeResolvedWiki(current, 'W1', resolvedDoc)
    expect(out).toBe(current)
  })

  it('keeps the existing title when the resolved node has none', () => {
    const out = mergeResolvedWiki(wikiCtx('W1'), 'W1', resolvedDoc)
    expect(out.title).toBe('知识库…')
    expect(out.feishu).toBe(resolvedDoc)
  })

  it('supports dropping to homepage (feishu undefined) only while still on the node', () => {
    expect(mergeResolvedWiki(wikiCtx('W1'), 'W1', undefined).feishu).toBeUndefined()
    const other = wikiCtx('W2')
    expect(mergeResolvedWiki(other, 'W1', undefined)).toBe(other) // stale drop ignored
  })
})
