/**
 * Live integration test for the compound Base tools (dedupe / cross-table lookup /
 * conditional update / audit), against the real Feishu Open API.
 *
 * Skipped unless FEISHU_LIVE=1, so it never runs in normal `npm test`.
 * Reads credentials from feishu-app-config.txt at the repo root.
 * Leaves a Base named 自测_可删_<pid> (and its tables) behind — safe to delete.
 *
 * Run with:  FEISHU_LIVE=1 npx vitest run src/shared/feishu/compose.live.test.ts
 *
 * Note: executeTool does NOT enforce the destructive-confirmation gate (that lives
 * in runAgent), so dedupe_records can be driven directly here — same as delete_table.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { getTenantAccessToken } from './auth'
import { cellToString } from './compose'
import { executeTool } from '../ai/agent'
import type { PageContext } from '../types'

const LIVE = process.env.FEISHU_LIVE === '1'

describe.runIf(LIVE)('Feishu compound tools (live)', () => {
  let token: string
  let appToken: string
  const ctx: PageContext = { url: '', title: '', selectedText: '' }
  const call = (name: string, args: Record<string, unknown>) => executeTool(name, args, token, ctx)

  // Create a table and return its id.
  async function newTable(name: string, fields: Array<Record<string, unknown>>): Promise<string> {
    const res = (await call('create_table', { app_token: appToken, table_name: name, fields })) as {
      table_id: string
    }
    return res.table_id
  }

  // Read all records (small tables only) via list_records.
  async function records(tableId: string): Promise<Array<{ record_id: string; fields: Record<string, unknown> }>> {
    const r = (await call('list_records', { app_token: appToken, table_id: tableId, page_size: 100 })) as {
      items: Array<{ record_id: string; fields: Record<string, unknown> }>
    }
    return r.items
  }

  beforeAll(async () => {
    const cfg = readFileSync('feishu-app-config.txt', 'utf8')
    const appId = cfg.match(/APP_ID\s*=\s*(\S+)/i)![1]
    const appSecret = cfg.match(/App_Secret\s*=\s*(\S+)/i)![1]
    token = await getTenantAccessToken(appId, appSecret)

    const app = (await call('create_bitable_app', { name: `自测_可删_${process.pid}` })) as {
      app: { app_token: string }
    }
    appToken = app.app.app_token
  }, 30_000)

  it('update_where: dry_run counts, then sets the field on all matches', async () => {
    const tableId = await newTable('update_where表', [
      { field_name: '标题', type: 1 },
      { field_name: '状态', type: 3, options: [{ name: '待办' }, { name: '进行中' }, { name: '已完成' }] },
    ])
    await call('batch_create_records', {
      app_token: appToken,
      table_id: tableId,
      records: [
        { fields: { 标题: 'A', 状态: '待办' } },
        { fields: { 标题: 'B', 状态: '待办' } },
        { fields: { 标题: 'C', 状态: '已完成' } },
      ],
    })

    const dry = (await call('update_where', {
      app_token: appToken,
      table_id: tableId,
      filter: 'CurrentValue.[状态]="待办"',
      set: { 状态: '进行中' },
      dry_run: true,
    })) as { matched: number; updated: number }
    expect(dry.matched).toBe(2)
    expect(dry.updated).toBe(0)

    const run = (await call('update_where', {
      app_token: appToken,
      table_id: tableId,
      filter: 'CurrentValue.[状态]="待办"',
      set: { 状态: '进行中' },
    })) as { updated: number }
    expect(run.updated).toBe(2)

    const after = await records(tableId)
    const byTitle = (t: string) => cellToString(after.find((r) => cellToString(r.fields.标题) === t)?.fields.状态)
    expect(byTitle('A')).toBe('进行中')
    expect(byTitle('B')).toBe('进行中')
    expect(byTitle('C')).toBe('已完成')
  }, 60_000)

  it('cross_table_lookup: fills matched rows, creates the column, counts unmatched', async () => {
    const empTable = await newTable('员工表', [
      { field_name: '工号', type: 1 },
      { field_name: '部门', type: 1 },
    ])
    await call('batch_create_records', {
      app_token: appToken,
      table_id: empTable,
      records: [
        { fields: { 工号: '001', 部门: '研发' } },
        { fields: { 工号: '002', 部门: '销售' } },
      ],
    })

    const attTable = await newTable('考勤表', [{ field_name: '工号', type: 1 }])
    await call('batch_create_records', {
      app_token: appToken,
      table_id: attTable,
      records: [
        { fields: { 工号: '001' } },
        { fields: { 工号: '002' } },
        { fields: { 工号: '999' } }, // unmatched
      ],
    })

    const res = (await call('cross_table_lookup', {
      app_token: appToken,
      source_table_id: attTable,
      source_key_field: '工号',
      target_table_id: empTable,
      target_key_field: '工号',
      target_value_field: '部门',
      into_field: '部门', // does not exist on 考勤表 → should be created
    })) as { created_field: boolean; filled: number; unmatched: number }

    expect(res.created_field).toBe(true)
    expect(res.filled).toBe(2)
    expect(res.unmatched).toBe(1)

    const after = await records(attTable)
    const deptOf = (gh: string) => cellToString(after.find((r) => cellToString(r.fields.工号) === gh)?.fields.部门)
    expect(deptOf('001')).toBe('研发')
    expect(deptOf('002')).toBe('销售')
    expect(deptOf('999')).toBe('') // unmatched → left blank
  }, 60_000)

  it('dedupe_records: dry_run previews, then keep=first deletes the rest', async () => {
    const tableId = await newTable('dedupe表', [
      { field_name: '标题', type: 1 },
      { field_name: '邮箱', type: 1 },
    ])
    await call('batch_create_records', {
      app_token: appToken,
      table_id: tableId,
      records: [
        { fields: { 标题: 'A', 邮箱: 'a@x.com' } },
        { fields: { 标题: 'A2', 邮箱: 'a@x.com' } }, // dup
        { fields: { 标题: 'B', 邮箱: 'b@x.com' } },
      ],
    })

    const dry = (await call('dedupe_records', {
      app_token: appToken,
      table_id: tableId,
      key_fields: ['邮箱'],
      dry_run: true,
    })) as { duplicate_groups: number; to_delete: number; deleted: number }
    expect(dry.duplicate_groups).toBe(1)
    expect(dry.to_delete).toBe(1)
    expect(dry.deleted).toBe(0)

    const run = (await call('dedupe_records', {
      app_token: appToken,
      table_id: tableId,
      key_fields: ['邮箱'],
      keep: 'first',
    })) as { deleted: number }
    expect(run.deleted).toBe(1)

    const after = await records(tableId)
    expect(after.length).toBe(2)
    const emails = after.map((r) => cellToString(r.fields.邮箱)).sort()
    expect(emails).toEqual(['a@x.com', 'b@x.com'])
  }, 60_000)

  it('audit_table: detects empty required, duplicates, and a numeric outlier', async () => {
    const tableId = await newTable('audit表', [
      { field_name: '名称', type: 1 },
      { field_name: '邮箱', type: 1 },
      { field_name: '金额', type: 2 },
    ])
    // 11 normal rows (金额=1) + 1 outlier row (金额=1000), plus one empty 名称 and a duplicate 邮箱.
    const rows = Array.from({ length: 11 }, (_, i) => ({
      fields: { 名称: `N${i}`, 邮箱: `e${i}@a.com`, 金额: 1 } as Record<string, unknown>,
    }))
    rows[1].fields.名称 = '' // empty required
    rows.push({ fields: { 名称: '异常', 邮箱: 'e10@a.com', 金额: 1000 } }) // dup email (e10) + outlier

    await call('batch_create_records', { app_token: appToken, table_id: tableId, records: rows })

    const report = (await call('audit_table', {
      app_token: appToken,
      table_id: tableId,
      required_fields: ['名称'],
      unique_fields: ['邮箱'],
      numeric_outlier_fields: ['金额'],
    })) as {
      empty_required: Record<string, { count: number }>
      duplicates: Record<string, Array<{ value: string; count: number }>>
      outliers: Record<string, { count: number }>
    }

    expect(report.empty_required['名称'].count).toBe(1)
    expect(report.duplicates['邮箱']).toEqual([{ value: 'e10@a.com', count: 2 }])
    expect(report.outliers['金额'].count).toBe(1)
  }, 60_000)
})
