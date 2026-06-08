/**
 * Live integration test against the real Feishu Open API.
 *
 * Skipped unless FEISHU_LIVE=1, so it never runs in normal `npm test`.
 * Reads credentials from feishu-app-config.txt at the repo root.
 *
 * Run with:  FEISHU_LIVE=1 npx vitest run src/shared/feishu/live.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { getTenantAccessToken } from './auth'
import * as API from './api'
import { executeTool } from '../ai/agent'
import type { PageContext } from '../types'

const LIVE = process.env.FEISHU_LIVE === '1'

describe.runIf(LIVE)('Feishu live API', () => {
  let token: string
  let appToken: string
  let tableId: string
  const ctx: PageContext = { url: '', title: '', selectedText: '' }
  const call = (name: string, args: Record<string, unknown>) => executeTool(name, args, token, ctx)

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

  it('create_table with a single-select field', async () => {
    const res = (await call('create_table', {
      app_token: appToken,
      table_name: '任务表',
      fields: [
        { field_name: '标题', type: 1 },
        { field_name: '状态', type: 3, options: [{ name: '待办' }, { name: '进行中' }] },
      ],
    })) as { table_id: string }
    tableId = res.table_id
    expect(tableId).toMatch(/^tbl/)
  }, 30_000)

  it('update_field backfills type so a rename + options change succeeds', async () => {
    const fields = (await call('list_fields', { app_token: appToken, table_id: tableId })) as {
      items: Array<{ field_id: string; field_name: string; type: number }>
    }
    const status = fields.items.find((f) => f.field_name === '状态')!
    expect(status.type).toBe(3)

    // Note: NO `type` passed — executeTool must backfill it from the current field,
    // otherwise Feishu returns 400 (this is the bug the fix addresses).
    await call('update_field', {
      app_token: appToken,
      table_id: tableId,
      field_id: status.field_id,
      field_name: '状态(已改名)',
      options: [{ name: '待办' }, { name: '进行中' }, { name: '已完成' }],
    })

    const after = (await call('list_fields', { app_token: appToken, table_id: tableId })) as {
      items: Array<{ field_id: string; field_name: string }>
    }
    expect(after.items.find((f) => f.field_id === status.field_id)?.field_name).toBe('状态(已改名)')
  }, 30_000)

  it('raw API.updateField WITHOUT type fails (proves why backfill is needed)', async () => {
    const fields = (await call('list_fields', { app_token: appToken, table_id: tableId })) as {
      items: Array<{ field_id: string; field_name: string }>
    }
    const title = fields.items.find((f) => f.field_name === '标题')!
    await expect(
      API.updateField(token, appToken, tableId, title.field_id, { field_name: '标题2' })
    ).rejects.toThrow()
  }, 30_000)

  it('batch_create_records then list_records', async () => {
    await call('batch_create_records', {
      app_token: appToken,
      table_id: tableId,
      records: [
        { fields: { 标题: '任务A', '状态(已改名)': '待办' } },
        { fields: { 标题: '任务B', '状态(已改名)': '已完成' } },
      ],
    })
    const list = (await call('list_records', { app_token: appToken, table_id: tableId })) as {
      items: unknown[]
    }
    expect(list.items.length).toBeGreaterThanOrEqual(2)
  }, 30_000)

  it('delete_table removes the table', async () => {
    await call('delete_table', { app_token: appToken, table_id: tableId })
    const tables = (await call('list_tables', { app_token: appToken })) as {
      items: Array<{ table_id: string }>
    }
    expect(tables.items.find((t) => t.table_id === tableId)).toBeUndefined()
  }, 30_000)
})
