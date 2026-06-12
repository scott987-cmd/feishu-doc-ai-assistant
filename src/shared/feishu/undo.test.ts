import { describe, it, expect, vi, beforeEach } from 'vitest'

const mem: Record<string, unknown> = {}
;(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: { local: {
    get: (keys: string[], cb: (r: Record<string, unknown>) => void) => { const r: Record<string, unknown> = {}; for (const k of keys) if (k in mem) r[k] = mem[k]; cb(r) },
    set: (o: Record<string, unknown>, cb?: () => void) => { Object.assign(mem, o); cb?.() },
  } },
}
const mockGet = vi.fn(), mockCreate = vi.fn(), mockFields = vi.fn()
vi.mock('./api', () => ({
  batchGetRecords: (...a: unknown[]) => mockGet(...a),
  batchCreateRecords: (...a: unknown[]) => mockCreate(...a),
  listFields: (...a: unknown[]) => mockFields(...a),
}))
const mockListSheets = vi.fn(), mockReadRange = vi.fn(), mockInsertDim = vi.fn(), mockWriteRange = vi.fn()
vi.mock('./sheets', () => ({
  listSheets: (...a: unknown[]) => mockListSheets(...a),
  readRange: (...a: unknown[]) => mockReadRange(...a),
  insertDimension: (...a: unknown[]) => mockInsertDim(...a),
  writeRange: (...a: unknown[]) => mockWriteRange(...a),
}))

const { captureRecords, captureSheetRows, saveDeleteUndo, loadDeleteUndo, clearDeleteUndo, restoreDeleteUndo, UNDO_TTL_MS } = await import('./undo')

beforeEach(() => { for (const k of Object.keys(mem)) delete mem[k]; for (const m of [mockGet, mockCreate, mockFields, mockListSheets, mockReadRange, mockInsertDim, mockWriteRange]) m.mockReset() })

describe('delete undo', () => {
  it('captureRecords keeps WRITABLE fields, strips read-only (formula/created-time), never throws', async () => {
    mockGet.mockResolvedValue({ records: [{ record_id: 'r1', fields: { 名称: 'A', 公式列: 99, 创建时间: 123 } }] })
    mockFields.mockResolvedValue({ items: [{ field_name: '名称', type: 1 }, { field_name: '公式列', type: 20 }, { field_name: '创建时间', type: 1001 }] })
    // formula(20) + createdTime(1001) stripped → batch_create won't be rejected
    expect(await captureRecords('t', 'app', 'tbl', ['r1'])).toEqual([{ fields: { 名称: 'A' } }])
    mockGet.mockRejectedValue(new Error('403'))
    expect(await captureRecords('t', 'app', 'tbl', ['r1'])).toEqual([]) // capture failure never blocks delete
    expect(await captureRecords('t', 'app', 'tbl', [])).toEqual([])
  })

  it('converts complex fields to WRITE format (user → [{id}]) and drops uncertain ones (link)', async () => {
    mockGet.mockResolvedValue({ records: [{ record_id: 'r1', fields: { 名称: 'A', 负责人: [{ id: 'ou_1', name: '张三' }], 关联: [{ record_id: 'recX' }] } }] })
    mockFields.mockResolvedValue({ items: [{ field_name: '名称', type: 1 }, { field_name: '负责人', type: 11 }, { field_name: '关联', type: 18 }] })
    // user(11) → [{id}] (so batch_create accepts it); link(18) dropped (write format uncertain)
    expect(await captureRecords('t', 'app', 'tbl', ['r1'])).toEqual([{ fields: { 名称: 'A', 负责人: [{ id: 'ou_1' }] } }])
  })

  it('flattens a rich-text text field (segment array) to a plain string (fixes 1254060 TextFieldConvFail)', async () => {
    mockGet.mockResolvedValue({ records: [{ record_id: 'r1', fields: { 备注: [{ type: 'text', text: '你好' }, { type: 'text', text: '世界' }] } }] })
    mockFields.mockResolvedValue({ items: [{ field_name: '备注', type: 1 }] })
    expect(await captureRecords('t', 'app', 'tbl', ['r1'])).toEqual([{ fields: { 备注: '你好世界' } }])
  })

  it('save + load round-trips with a computed batch label; empty op stores nothing', async () => {
    await saveDeleteUndo({ kind: 'records', appToken: 'app', tableId: 'tbl', records: [{ fields: { x: 1 } }, { fields: { x: 2 } }] })
    const u = await loadDeleteUndo()
    expect(u?.label).toBe('删除 2 条记录')
    expect(u?.ops).toHaveLength(1)
    await clearDeleteUndo()
    await saveDeleteUndo({ kind: 'records', appToken: 'app', tableId: 'tbl', records: [] })
    expect(await loadDeleteUndo()).toBeNull()
  })

  it('MERGES consecutive deletes into ONE batch (multi-call delete is undone as a whole)', async () => {
    await saveDeleteUndo({ kind: 'records', appToken: 'app', tableId: 'tbl', records: [{ fields: { x: 1 } }] })
    await saveDeleteUndo({ kind: 'sheetRows', spreadsheetToken: 'ss', sheetId: 'sh1', startIndex: 0, values: [['标题']] })
    const u = await loadDeleteUndo()
    expect(u?.ops).toHaveLength(2)            // both deletes kept (no clobber)
    expect(u?.label).toBe('删除 1 条记录、1 行')
  })

  it('ignores an expired batch (older than TTL)', async () => {
    mem['_last_delete_undo_v1'] = { at: Date.now() - UNDO_TTL_MS - 1000, ops: [{ kind: 'records', appToken: 'a', tableId: 't', records: [{ fields: { x: 1 } }] }] }
    expect(await loadDeleteUndo()).toBeNull()
  })

  it('captureSheetRows reads the deleted rows values for undo (A1 range from col count)', async () => {
    mockListSheets.mockResolvedValue({ sheets: [{ sheet_id: 'sh1', grid_properties: { column_count: 3 } }] })
    mockReadRange.mockResolvedValue({ valueRange: { values: [['a', 'b', 'c'], ['d', 'e', 'f']] } })
    const u = await captureSheetRows('t', 'ss', 'sh1', 5, 2)
    expect(u).toMatchObject({ kind: 'sheetRows', spreadsheetToken: 'ss', sheetId: 'sh1', startIndex: 5, values: [['a', 'b', 'c'], ['d', 'e', 'f']] })
    expect(mockReadRange).toHaveBeenCalledWith('t', 'ss', 'sh1!A6:C7') // rows 6-7 (0-based 5..6), cols A-C
  })

  it('restore re-inserts the rows and writes the captured values back', async () => {
    mockInsertDim.mockResolvedValue({}); mockWriteRange.mockResolvedValue({})
    const n = await restoreDeleteUndo('tok', { ops: [{ kind: 'sheetRows', spreadsheetToken: 'ss', sheetId: 'sh1', startIndex: 5, values: [['a', 'b'], ['c', 'd']] }] })
    expect(n).toBe(2)
    expect(mockInsertDim).toHaveBeenCalledWith('tok', 'ss', 'sh1', 'ROWS', 5, 2)
    expect(mockWriteRange).toHaveBeenCalledWith('tok', 'ss', 'sh1!A6:B7', [['a', 'b'], ['c', 'd']])
  })

  it('restore re-creates the captured records and returns the count', async () => {
    mockCreate.mockResolvedValue({})
    const n = await restoreDeleteUndo('tok', { ops: [{ kind: 'records', appToken: 'app', tableId: 'tbl', records: [{ fields: { x: 1 } }, { fields: { x: 2 } }] }] })
    expect(n).toBe(2)
    expect(mockCreate).toHaveBeenCalledWith('tok', 'app', 'tbl', [{ fields: { x: 1 } }, { fields: { x: 2 } }])
  })

  it('restores a BATCH in REVERSE order (last deleted re-inserted first → indices reconstruct)', async () => {
    mockInsertDim.mockResolvedValue({}); mockWriteRange.mockResolvedValue({})
    // ops in delete order: header row (idx0) then a later data row (idx0 after the shift)
    const n = await restoreDeleteUndo('tok', { ops: [
      { kind: 'sheetRows', spreadsheetToken: 'ss', sheetId: 'sh1', startIndex: 0, values: [['标题']] },
      { kind: 'sheetRows', spreadsheetToken: 'ss', sheetId: 'sh1', startIndex: 0, values: [['数据']] },
    ] })
    expect(n).toBe(2)
    // reverse order: the SECOND op (数据) is re-inserted FIRST, then the header
    expect(mockWriteRange.mock.calls[0][3]).toEqual([['数据']])
    expect(mockWriteRange.mock.calls[1][3]).toEqual([['标题']])
  })
})
