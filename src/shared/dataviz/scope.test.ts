import { describe, it, expect } from 'vitest'
import { vizDocKey, ctxDocKey, ctxScopeKey, vizMatchesCtx, savedVizMatchesCtx } from './scope'
import type { VizSource } from './types'

describe('savedVizMatchesCtx — multi-table site shows on any table of its Base', () => {
  const src: VizSource = { kind: 'base', appToken: 'APP', tableId: 't1' }
  it('single-table viz: only its own table (per-table)', () => {
    expect(savedVizMatchesCtx({ multi: false, source: src }, { kind: 'base', appToken: 'APP', tableId: 't1' })).toBe(true)
    expect(savedVizMatchesCtx({ multi: false, source: src }, { kind: 'base', appToken: 'APP', tableId: 't2' })).toBe(false)
  })
  it('MULTI site: matches ANY table of the same Base (the bug fix)', () => {
    expect(savedVizMatchesCtx({ multi: true, source: src }, { kind: 'base', appToken: 'APP', tableId: 't2' })).toBe(true)
    expect(savedVizMatchesCtx({ multi: true, source: src }, { kind: 'base', appToken: 'APP' })).toBe(true)
    expect(savedVizMatchesCtx({ multi: true, source: src }, { kind: 'base', appToken: 'OTHER', tableId: 't1' })).toBe(false)
  })
})

describe('dataviz scope keys', () => {
  it('vizDocKey is a coarse doc-level key (Base app / Spreadsheet)', () => {
    const base: VizSource = { kind: 'base', appToken: 'APP', tableId: 'tblX' }
    const sheet: VizSource = { kind: 'sheet', spreadsheetToken: 'SS', range: 'sid!A1:B2' }
    expect(vizDocKey(base)).toBe('base:APP')
    expect(vizDocKey(sheet)).toBe('sheet:SS')
  })

  it('ctxDocKey gates "on a Base/Sheet at all"; null otherwise', () => {
    expect(ctxDocKey({ kind: 'base', appToken: 'APP' })).toBe('base:APP')
    expect(ctxDocKey({ kind: 'sheet', spreadsheetToken: 'SS' })).toBe('sheet:SS')
    expect(ctxDocKey(null)).toBeNull()
    expect(ctxDocKey({ kind: 'doc' })).toBeNull()
  })

  it('ctxScopeKey is per-TABLE for Base (distinguishes tables in one app), per-file for Sheet', () => {
    expect(ctxScopeKey({ kind: 'base', appToken: 'APP', tableId: 'tblA' })).toBe('base:APP:tblA')
    expect(ctxScopeKey({ kind: 'base', appToken: 'APP', tableId: 'tblB' })).toBe('base:APP:tblB')
    // two tables of one Base get DISTINCT cache keys (the bug fix) ...
    expect(ctxScopeKey({ kind: 'base', appToken: 'APP', tableId: 'tblA' }))
      .not.toBe(ctxScopeKey({ kind: 'base', appToken: 'APP', tableId: 'tblB' }))
    // ... and fall back to the whole Base when the URL carries no table
    expect(ctxScopeKey({ kind: 'base', appToken: 'APP' })).toBe('base:APP')
    expect(ctxScopeKey({ kind: 'sheet', spreadsheetToken: 'SS' })).toBe('sheet:SS')
    expect(ctxScopeKey(null)).toBeNull()
  })
})

describe('vizMatchesCtx — per-table scoping', () => {
  const t1: VizSource = { kind: 'base', appToken: 'APP', tableId: 't1' }
  const t2: VizSource = { kind: 'base', appToken: 'APP', tableId: 't2' }
  const other: VizSource = { kind: 'base', appToken: 'OTHER', tableId: 'tx' }
  const sheet: VizSource = { kind: 'sheet', spreadsheetToken: 'SS', range: 'r' }

  it('Base: only the CURRENT data-table within a doc matches', () => {
    const ctx = { kind: 'base', appToken: 'APP', tableId: 't1' }
    expect(vizMatchesCtx(t1, ctx)).toBe(true)
    expect(vizMatchesCtx(t2, ctx)).toBe(false) // same Base file, different table → hidden
    expect(vizMatchesCtx(other, ctx)).toBe(false)
  })

  it('Base: no ?table= in the URL → fall back to whole-app (show all so nothing is hidden)', () => {
    const ctx = { kind: 'base', appToken: 'APP' }
    expect(vizMatchesCtx(t1, ctx)).toBe(true)
    expect(vizMatchesCtx(t2, ctx)).toBe(true)
    expect(vizMatchesCtx(other, ctx)).toBe(false)
  })

  it('Sheet: matches by spreadsheet file', () => {
    expect(vizMatchesCtx(sheet, { kind: 'sheet', spreadsheetToken: 'SS' })).toBe(true)
    expect(vizMatchesCtx(sheet, { kind: 'sheet', spreadsheetToken: 'OTHER' })).toBe(false)
    expect(vizMatchesCtx(t1, { kind: 'sheet', spreadsheetToken: 'SS' })).toBe(false)
  })

  it('a mixed list filters down to just the current table', () => {
    const ctx = { kind: 'base', appToken: 'APP', tableId: 't1' }
    expect([t1, t2, other, sheet].filter((s) => vizMatchesCtx(s, ctx))).toEqual([t1])
  })
})
