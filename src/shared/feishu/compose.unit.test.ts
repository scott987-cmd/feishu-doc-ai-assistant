import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the network layer so the compound functions can be tested as pure logic.
const mocks = vi.hoisted(() => ({
  listRecords: vi.fn(),
  searchRecords: vi.fn(),
  batchDeleteRecords: vi.fn(),
  batchUpdateRecords: vi.fn(),
  listFields: vi.fn(),
  createField: vi.fn(),
}))

vi.mock('./api', async (importActual) => {
  const actual = await importActual<typeof import('./api')>()
  return { ...actual, ...mocks }
})

import { dedupeRecords, crossTableLookup, updateWhere, auditTable } from './compose'

const T = 'tok'
const APP = 'appXYZ'

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset()
})

// ─── dedupeRecords ────────────────────────────────────────────────────────────

describe('dedupeRecords', () => {
  const recs = [
    { record_id: 'r1', fields: { 邮箱: 'a@x.com', 名称: 'A' } },
    { record_id: 'r2', fields: { 邮箱: 'a@x.com', 名称: 'A2' } },
    { record_id: 'r3', fields: { 邮箱: 'b@x.com', 名称: 'B' } },
  ]

  it('dry_run reports duplicates without deleting', async () => {
    mocks.listRecords.mockResolvedValue({ items: recs, has_more: false })
    const res = await dedupeRecords(T, APP, 'tbl', ['邮箱'], 'first', true)
    expect(res.duplicate_groups).toBe(1)
    expect(res.to_delete).toBe(1)
    expect(res.deleted).toBe(0)
    expect(mocks.batchDeleteRecords).not.toHaveBeenCalled()
  })

  it('keep=first deletes the later duplicate', async () => {
    mocks.listRecords.mockResolvedValue({ items: recs, has_more: false })
    const res = await dedupeRecords(T, APP, 'tbl', ['邮箱'], 'first', false)
    expect(res.deleted).toBe(1)
    expect(mocks.batchDeleteRecords).toHaveBeenCalledWith(T, APP, 'tbl', ['r2'])
  })

  it('keep=last deletes the earlier duplicate', async () => {
    mocks.listRecords.mockResolvedValue({ items: recs, has_more: false })
    const res = await dedupeRecords(T, APP, 'tbl', ['邮箱'], 'last', false)
    expect(res.deleted).toBe(1)
    expect(mocks.batchDeleteRecords).toHaveBeenCalledWith(T, APP, 'tbl', ['r1'])
  })

  it('reports partial failure instead of throwing when a delete batch fails', async () => {
    mocks.listRecords.mockResolvedValue({ items: recs, has_more: false })
    mocks.batchDeleteRecords.mockRejectedValueOnce(new Error('Feishu API error (code=1254): boom'))
    const res = await dedupeRecords(T, APP, 'tbl', ['邮箱'], 'first', false)
    expect(res.deleted).toBe(0)
    expect((res as { partial_failure?: string }).partial_failure).toMatch(/boom/)
    expect((res as { remaining_undeleted?: number }).remaining_undeleted).toBe(1)
  })

  it('treats distinct field values as distinct keys (no false merge)', async () => {
    mocks.listRecords.mockResolvedValue({
      items: [
        { record_id: 'r1', fields: { a: 'x', b: 'yz' } },
        { record_id: 'r2', fields: { a: 'xy', b: 'z' } }, // "x|yz" must not collide with "xy|z"
      ],
      has_more: false,
    })
    const res = await dedupeRecords(T, APP, 'tbl', ['a', 'b'], 'first', true)
    expect(res.duplicate_groups).toBe(0)
  })
})

// ─── crossTableLookup ─────────────────────────────────────────────────────────

describe('crossTableLookup', () => {
  function wireTwoTables(targetRecs: unknown[], sourceRecs: unknown[], sourceFields: string[]) {
    mocks.listRecords.mockImplementation((_t, _a, table) =>
      Promise.resolve({ items: table === 'B' ? targetRecs : sourceRecs, has_more: false })
    )
    mocks.listFields.mockResolvedValue({ items: sourceFields.map((field_name) => ({ field_name })) })
  }

  it('fills matched rows, counts unmatched, creates missing column', async () => {
    wireTwoTables(
      [
        { record_id: 'b1', fields: { 工号: '001', 部门: '研发' } },
        { record_id: 'b2', fields: { 工号: '002', 部门: '销售' } },
      ],
      [
        { record_id: 'a1', fields: { 工号: '001' } },
        { record_id: 'a2', fields: { 工号: '002' } },
        { record_id: 'a3', fields: { 工号: '999' } },
      ],
      ['工号'] // into_field 部门 missing → should be created
    )
    const res = await crossTableLookup(T, APP, 'A', '工号', 'B', '工号', '部门', '部门', 'first', true)
    expect(res.created_field).toBe(true)
    expect(res.filled).toBe(2)
    expect(res.unmatched).toBe(1)
    expect(mocks.createField).toHaveBeenCalledTimes(1)
    expect(mocks.batchUpdateRecords).toHaveBeenCalledWith(T, APP, 'A', [
      { record_id: 'a1', fields: { 部门: '研发' } },
      { record_id: 'a2', fields: { 部门: '销售' } },
    ])
  })

  it('on_multiple=join concatenates all hits; no field created when it exists', async () => {
    wireTwoTables(
      [
        { record_id: 'b1', fields: { 工号: '001', 部门: '研发' } },
        { record_id: 'b2', fields: { 工号: '001', 部门: '测试' } },
      ],
      [{ record_id: 'a1', fields: { 工号: '001', 部门: '' } }],
      ['工号', '部门'] // into_field exists
    )
    const res = await crossTableLookup(T, APP, 'A', '工号', 'B', '工号', '部门', '部门', 'join', true)
    expect(res.created_field).toBe(false)
    expect(res.multi_hit).toBe(1)
    expect(res.filled).toBe(1)
    expect(mocks.createField).not.toHaveBeenCalled()
    expect(mocks.batchUpdateRecords).toHaveBeenCalledWith(T, APP, 'A', [
      { record_id: 'a1', fields: { 部门: '研发, 测试' } },
    ])
  })

  it('on_multiple=skip leaves ambiguous rows unwritten', async () => {
    wireTwoTables(
      [
        { record_id: 'b1', fields: { k: 'x', v: '1' } },
        { record_id: 'b2', fields: { k: 'x', v: '2' } },
      ],
      [{ record_id: 'a1', fields: { k: 'x', v2: '' } }],
      ['k', 'v2']
    )
    const res = await crossTableLookup(T, APP, 'A', 'k', 'B', 'k', 'v', 'v2', 'skip', true)
    expect(res.filled).toBe(0)
    expect(res.multi_hit).toBe(1)
    // Nothing to write → no batch call is issued.
    expect(mocks.batchUpdateRecords).not.toHaveBeenCalled()
  })
})

// ─── updateWhere ──────────────────────────────────────────────────────────────

describe('updateWhere', () => {
  const matched = [
    { record_id: 'r1', fields: { 状态: '待处理' } },
    { record_id: 'r2', fields: { 状态: '待处理' } },
  ]

  it('dry_run returns match count without updating', async () => {
    mocks.searchRecords.mockResolvedValue({ items: matched, has_more: false })
    const res = await updateWhere(T, APP, 'tbl', 'CurrentValue.[状态]="待处理"', { 状态: '已完成' }, true)
    expect(res.matched).toBe(2)
    expect(res.updated).toBe(0)
    expect(mocks.batchUpdateRecords).not.toHaveBeenCalled()
  })

  it('applies set to all matched records', async () => {
    mocks.searchRecords.mockResolvedValue({ items: matched, has_more: false })
    const res = await updateWhere(T, APP, 'tbl', 'CurrentValue.[状态]="待处理"', { 状态: '已完成' }, false)
    expect(res.updated).toBe(2)
    expect(mocks.batchUpdateRecords).toHaveBeenCalledWith(T, APP, 'tbl', [
      { record_id: 'r1', fields: { 状态: '已完成' } },
      { record_id: 'r2', fields: { 状态: '已完成' } },
    ])
  })
})

// ─── auditTable ───────────────────────────────────────────────────────────────

describe('auditTable', () => {
  it('detects empty required, duplicates, and numeric outliers', async () => {
    const recs = Array.from({ length: 20 }, (_, i) => ({
      record_id: `r${i}`,
      fields: { 名称: `N${i}`, 邮箱: `e${i}@a.com`, 金额: 1 } as Record<string, unknown>,
    }))
    recs[1].fields.名称 = '' // one empty required
    recs[2].fields.邮箱 = recs[3].fields.邮箱 // duplicate email (e3@a.com appears twice)
    recs.push({ record_id: 'rX', fields: { 名称: 'X', 邮箱: 'uniq@a.com', 金额: 1_000_000 } })

    mocks.listRecords.mockResolvedValue({ items: recs, has_more: false })
    const report = await auditTable(T, APP, 'tbl', {
      requiredFields: ['名称'],
      uniqueFields: ['邮箱'],
      numericFields: ['金额'],
    })

    expect(report.empty_required['名称'].count).toBe(1)
    expect(report.duplicates['邮箱']).toEqual([{ value: 'e3@a.com', count: 2 }])
    expect(report.outliers['金额'].count).toBe(1)
    expect(report.outliers['金额'].sample[0].value).toBe(1_000_000)
    expect(report.issues_total).toBe(3)
  })

  it('reports zero issues on a clean table', async () => {
    mocks.listRecords.mockResolvedValue({
      items: [
        { record_id: 'r1', fields: { 名称: 'A', 邮箱: 'a@x.com' } },
        { record_id: 'r2', fields: { 名称: 'B', 邮箱: 'b@x.com' } },
      ],
      has_more: false,
    })
    const report = await auditTable(T, APP, 'tbl', { requiredFields: ['名称'], uniqueFields: ['邮箱'] })
    expect(report.issues_total).toBe(0)
    expect(report.empty_required).toEqual({})
    expect(report.duplicates).toEqual({})
  })
})
