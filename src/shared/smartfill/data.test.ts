import { describe, it, expect, vi, beforeEach } from 'vitest'

const listTables = vi.fn()
const listSheets = vi.fn()
vi.mock('../feishu/api', () => ({ listTables: (...a: unknown[]) => listTables(...a), listFields: vi.fn() }))
vi.mock('../feishu/sheets', () => ({ listSheets: (...a: unknown[]) => listSheets(...a), readRange: vi.fn() }))
vi.mock('../feishu/auth', () => ({ resolveToken: async () => 'tk' }))

const { resolveFillSource } = await import('./data')
const { DEFAULT_SETTINGS } = await import('../types')

beforeEach(() => { listTables.mockReset(); listSheets.mockReset() })

describe('resolveFillSource', () => {
  it('Base: uses the table id already in the URL context — no API call', async () => {
    const s = await resolveFillSource(DEFAULT_SETTINGS, { isBase: true, kind: 'base', appToken: 'APP', tableId: 'tblX' })
    expect(s).toEqual({ kind: 'base', appToken: 'APP', tableId: 'tblX' })
    expect(listTables).not.toHaveBeenCalled()
  })

  it('Base: falls back to the first table when the URL has no table id', async () => {
    listTables.mockResolvedValue({ items: [{ table_id: 'tbl1' }, { table_id: 'tbl2' }] })
    const s = await resolveFillSource(DEFAULT_SETTINGS, { isBase: true, kind: 'base', appToken: 'APP' })
    expect(s).toEqual({ kind: 'base', appToken: 'APP', tableId: 'tbl1' })
  })

  it('Sheet: builds a read range from the first worksheet grid bounds', async () => {
    listSheets.mockResolvedValue({ sheets: [{ sheet_id: 'sh1', grid_properties: { row_count: 50, column_count: 4 } }] })
    const s = await resolveFillSource(DEFAULT_SETTINGS, { isBase: false, kind: 'sheet', spreadsheetToken: 'SS' })
    expect(s).toEqual({ kind: 'sheet', spreadsheetToken: 'SS', sheetId: 'sh1', range: 'sh1!A1:D50' })
  })

  it('returns null for an unsupported context (wiki / doc)', async () => {
    expect(await resolveFillSource(DEFAULT_SETTINGS, { isBase: false, kind: 'wiki', wikiToken: 'w' })).toBeNull()
    expect(await resolveFillSource(DEFAULT_SETTINGS, { isBase: false, kind: 'doc', documentId: 'd' })).toBeNull()
  })
})
