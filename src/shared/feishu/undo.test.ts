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

const { captureRecords, saveDeleteUndo, loadDeleteUndo, clearDeleteUndo, restoreDeleteUndo, UNDO_TTL_MS } = await import('./undo')

beforeEach(() => { for (const k of Object.keys(mem)) delete mem[k]; mockGet.mockReset(); mockCreate.mockReset(); mockFields.mockReset() })

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

  it('save + load round-trips; empty capture stores nothing', async () => {
    await saveDeleteUndo({ appToken: 'app', tableId: 'tbl', label: '删除 2 条记录', records: [{ fields: { x: 1 } }, { fields: { x: 2 } }] })
    const u = await loadDeleteUndo()
    expect(u?.label).toBe('删除 2 条记录')
    expect(u?.records).toHaveLength(2)
    await clearDeleteUndo()
    await saveDeleteUndo({ appToken: 'app', tableId: 'tbl', label: 'x', records: [] })
    expect(await loadDeleteUndo()).toBeNull()
  })

  it('ignores an expired undo (older than TTL)', async () => {
    mem['_last_delete_undo_v1'] = { at: Date.now() - UNDO_TTL_MS - 1000, appToken: 'a', tableId: 't', label: 'old', records: [{ fields: { x: 1 } }] }
    expect(await loadDeleteUndo()).toBeNull()
  })

  it('restore re-creates the captured records and returns the count', async () => {
    mockCreate.mockResolvedValue({})
    const n = await restoreDeleteUndo('tok', { at: Date.now(), appToken: 'app', tableId: 'tbl', label: '', records: [{ fields: { x: 1 } }, { fields: { x: 2 } }] })
    expect(n).toBe(2)
    expect(mockCreate).toHaveBeenCalledWith('tok', 'app', 'tbl', [{ fields: { x: 1 } }, { fields: { x: 2 } }])
  })
})
