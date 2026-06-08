/**
 * Live verification of the Spreadsheet (Sheets) tools — drives the real agent
 * dispatch (executeTool → executeSheetTool → sheets.ts → Feishu API).
 *
 * Skipped unless SHEETS_LIVE=1. Needs the app to have `sheets:spreadsheet` (应用身份).
 * Run: SHEETS_LIVE=1 npx vitest run src/harness/sheets.test.ts --reporter=verbose
 */
import { describe, it, expect } from 'vitest'
import { tenantToken } from './driver'
import { executeTool } from '../shared/ai/agent'
import type { PageContext } from '../shared/types'

const LIVE = process.env.SHEETS_LIVE === '1'

describe.runIf(LIVE)('spreadsheet tools (live)', () => {
  const ctx: PageContext = { url: '', title: '', selectedText: '' }
  let token: string
  let ssToken: string
  let firstSheetId: string

  const call = (name: string, args: Record<string, unknown>) => executeTool(name, args, token, ctx)

  it('create_spreadsheet', async () => {
    token = await tenantToken()
    const r = (await call('create_spreadsheet', { title: `自测表格_${process.pid}` })) as {
      spreadsheet?: { spreadsheet_token?: string }
    }
    ssToken = r.spreadsheet!.spreadsheet_token!
    expect(ssToken).toBeTruthy()
    console.log('spreadsheet_token=', ssToken)
  }, 30_000)

  it('list_sheets returns the default worksheet', async () => {
    const r = (await call('list_sheets', { spreadsheet_token: ssToken })) as {
      sheets?: Array<{ sheet_id: string; title: string }>
    }
    expect(r.sheets && r.sheets.length).toBeGreaterThanOrEqual(1)
    firstSheetId = r.sheets![0].sheet_id
    console.log('first sheet_id=', firstSheetId)
  }, 30_000)

  it('write_range then read_range round-trips values', async () => {
    const range = `${firstSheetId}!A1:B2`
    await call('write_range', {
      spreadsheet_token: ssToken, range,
      values: [['姓名', '分数'], ['张三', 90]],
    })
    const r = (await call('read_range', { spreadsheet_token: ssToken, range })) as {
      valueRange?: { values?: unknown[][] }
    }
    const vals = r.valueRange?.values ?? []
    console.log('read back:', JSON.stringify(vals))
    expect(vals[0]?.[0]).toBe('姓名')
    expect(String(vals[1]?.[0])).toBe('张三')
  }, 30_000)

  it('append_rows adds a row', async () => {
    await call('append_rows', {
      spreadsheet_token: ssToken, range: `${firstSheetId}!A1:B1`,
      values: [['李四', 85]],
    })
    const r = (await call('read_range', { spreadsheet_token: ssToken, range: `${firstSheetId}!A1:B5` })) as {
      valueRange?: { values?: unknown[][] }
    }
    const nonEmpty = (r.valueRange?.values ?? []).filter((row) => row.some((c) => c !== null && c !== ''))
    expect(nonEmpty.length).toBeGreaterThanOrEqual(3)
  }, 30_000)

  it('formulas written as "=..." strings compute (not stored as text)', async () => {
    // 数量/单价 in A/B, then formula columns C(乘积) D(求和) E(IF)
    await call('write_range', {
      spreadsheet_token: ssToken, range: `${firstSheetId}!A10:B11`,
      values: [['数量', '单价'], [3, 5]],
    })
    await call('write_range', {
      spreadsheet_token: ssToken, range: `${firstSheetId}!C11:E11`,
      values: [['=A11*B11', '=SUM(A11:B11)', '=IF(A11>2,"多","少")']],
    })
    const r = (await call('read_range', { spreadsheet_token: ssToken, range: `${firstSheetId}!C11:E11` })) as {
      valueRange?: { values?: unknown[][] }
    }
    const row = r.valueRange?.values?.[0] ?? []
    console.log('formula results:', JSON.stringify(row))
    expect(String(row[0])).toBe('15')          // 3*5
    expect(String(row[1])).toBe('8')            // 3+5
    expect(String(row[2])).toBe('多')           // IF(3>2,...)
  }, 30_000)

  it('fill_column fills a per-row formula down a column', async () => {
    await call('write_range', {
      spreadsheet_token: ssToken, range: `${firstSheetId}!A20:A22`,
      values: [[1], [2], [3]],
    })
    await call('fill_column', {
      spreadsheet_token: ssToken, sheet_id: firstSheetId,
      column: 'G', start_row: 20, end_row: 22, template: '=A{row}*10',
    })
    const r = (await call('read_range', { spreadsheet_token: ssToken, range: `${firstSheetId}!G20:G22` })) as {
      valueRange?: { values?: unknown[][] }
    }
    expect((r.valueRange?.values ?? []).map((row) => String(row[0]))).toEqual(['10', '20', '30'])
  }, 30_000)

  it('find_replace / set_number_format / insert_dimension / delete_dimension run', async () => {
    await call('write_range', { spreadsheet_token: ssToken, range: `${firstSheetId}!A30:A30`, values: [['旧值']] })
    await call('find_replace', {
      spreadsheet_token: ssToken, sheet_id: firstSheetId, range: `${firstSheetId}!A30:A30`,
      find: '旧值', replacement: '新值',
    })
    const r = (await call('read_range', { spreadsheet_token: ssToken, range: `${firstSheetId}!A30:A30` })) as {
      valueRange?: { values?: unknown[][] }
    }
    expect(String(r.valueRange?.values?.[0]?.[0])).toBe('新值')

    // number format + dimension ops should not throw
    await call('set_number_format', { spreadsheet_token: ssToken, range: `${firstSheetId}!A31:A31`, formatter: '0.00%' })
    await call('insert_dimension', { spreadsheet_token: ssToken, sheet_id: firstSheetId, dimension: 'ROWS', start_index: 40, count: 2 })
    await call('delete_dimension', { spreadsheet_token: ssToken, sheet_id: firstSheetId, dimension: 'ROWS', start_index: 40, count: 2 })
  }, 30_000)

  it('add_sheet then delete_sheet', async () => {
    await call('add_sheet', { spreadsheet_token: ssToken, title: '第二页' })
    let r = (await call('list_sheets', { spreadsheet_token: ssToken })) as {
      sheets?: Array<{ sheet_id: string; title: string }>
    }
    const added = r.sheets!.find((s) => s.title === '第二页')
    expect(added).toBeTruthy()
    await call('delete_sheet', { spreadsheet_token: ssToken, sheet_id: added!.sheet_id })
    r = (await call('list_sheets', { spreadsheet_token: ssToken })) as {
      sheets?: Array<{ sheet_id: string; title: string }>
    }
    expect(r.sheets!.find((s) => s.title === '第二页')).toBeUndefined()
  }, 30_000)
})
