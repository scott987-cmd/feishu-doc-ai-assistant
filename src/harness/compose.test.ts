/**
 * Live verification of compound (non-native) features: summarize_table & base_table_to_sheet.
 * Needs bitable:app + sheets:spreadsheet. Run: SHEETS_LIVE=1 npx vitest run src/harness/compose.test.ts
 */
import { describe, it, expect } from 'vitest'
import { tenantToken, freshBase } from './driver'
import { executeTool } from '../shared/ai/agent'
import type { PageContext } from '../shared/types'

const LIVE = process.env.SHEETS_LIVE === '1'

describe.runIf(LIVE)('compound features (live)', () => {
  const ctx: PageContext = { url: '', title: '', selectedText: '' }
  let token: string
  let app: string
  let tableId: string
  const call = (name: string, args: Record<string, unknown>) => executeTool(name, args, token, ctx)

  it('setup: sales table with 3 rows', async () => {
    token = await tenantToken()
    app = await freshBase('compose')
    const tbl = (await call('create_table', {
      app_token: app, table_name: '销售',
      fields: [
        { field_name: '产品', type: 1 },
        { field_name: '地区', type: 3, options: [{ name: '华东' }, { name: '华南' }] },
        { field_name: '金额', type: 2 },
      ],
    })) as { table_id: string }
    tableId = tbl.table_id
    await call('batch_create_records', {
      app_token: app, table_id: tableId,
      records: [
        { fields: { 产品: 'A', 地区: '华东', 金额: 100 } },
        { fields: { 产品: 'B', 地区: '华南', 金额: 200 } },
        { fields: { 产品: 'C', 地区: '华东', 金额: 50 } },
      ],
    })
    expect(tableId).toBeTruthy()
  }, 40_000)

  it('summarize_table groups by 地区 and aggregates sum/count', async () => {
    const r = (await call('summarize_table', {
      app_token: app, table_id: tableId, group_by: '地区',
      metrics: [{ field: '金额', op: 'sum' }, { field: '', op: 'count' }],
    })) as { spreadsheet_token: string; sheet_id: string; groups: number }
    expect(r.groups).toBe(2)
    const read = (await call('read_range', {
      spreadsheet_token: r.spreadsheet_token, range: `${r.sheet_id}!A1:C5`,
    })) as { valueRange?: { values?: unknown[][] } }
    const rows = read.valueRange?.values ?? []
    console.log('summary grid:', JSON.stringify(rows))
    const east = rows.find((row) => row[0] === '华东')!
    const south = rows.find((row) => row[0] === '华南')!
    expect(String(east[1])).toBe('150')  // 100+50
    expect(String(east[2])).toBe('2')
    expect(String(south[1])).toBe('200')
    expect(String(south[2])).toBe('1')
  }, 40_000)

  it('base_table_to_sheet exports all rows', async () => {
    const r = (await call('base_table_to_sheet', { app_token: app, table_id: tableId })) as {
      spreadsheet_token: string; sheet_id: string; exported_rows: number
    }
    expect(r.exported_rows).toBe(3)
    const read = (await call('read_range', {
      spreadsheet_token: r.spreadsheet_token, range: `${r.sheet_id}!A1:C5`,
    })) as { valueRange?: { values?: unknown[][] } }
    const rows = read.valueRange?.values ?? []
    console.log('exported grid:', JSON.stringify(rows))
    expect(rows[0]).toContain('产品')   // header
    expect(rows.length).toBeGreaterThanOrEqual(4) // header + 3
  }, 40_000)
})
