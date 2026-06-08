import * as API from './api'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FieldCtx {
  fieldId: string
  fieldName: string
  type: number
  typeName: string
  options?: string[]       // SingleSelect / MultiSelect option names
}

export interface ViewCtx {
  viewId: string
  viewName: string
  viewType: string
}

export interface TableCtx {
  tableId: string
  tableName: string
  fields: FieldCtx[]
  views: ViewCtx[]
}

export interface BaseCtx {
  appToken: string
  appName: string
  tables: TableCtx[]
  currentTableId?: string
  fetchedAt: number
}

// ─── Field type name map ──────────────────────────────────────────────────────

const FIELD_TYPE_NAMES: Record<number, string> = {
  1: 'Text', 2: 'Number', 3: 'SingleSelect', 4: 'MultiSelect',
  5: 'DateTime', 7: 'Checkbox', 11: 'Person', 13: 'Phone',
  15: 'URL', 17: 'Attachment', 18: 'SingleLink', 19: 'Lookup', 20: 'Formula',
  21: 'DuplexLink', 22: 'Location', 1001: 'CreatedTime', 1002: 'ModifiedTime',
  1003: 'CreatedBy', 1004: 'ModifiedBy', 1005: 'AutoNumber',
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

export async function fetchBaseCtx(
  token: string,
  appToken: string,
  currentTableId?: string
): Promise<BaseCtx> {
  // App name
  const appInfo = await API.getApp(token, appToken) as { app?: { name?: string } }

  // Tables list
  const tablesRes = await API.listTables(token, appToken) as { items?: Array<{ table_id: string; name: string }> }
  const tables: TableCtx[] = []

  // Fetch fields + views for the first few tables (in parallel, max 6). ALWAYS include the user's
  // current table even if it sits beyond the cap — otherwise it's dropped from `tables`, and
  // callers doing `currentTableId || tables[0]` (and the ◀当前 marker / scoping) silently fall
  // back to the first table when the active table is e.g. the 7th.
  const items = tablesRes.items ?? []
  const top = items.slice(0, 6)
  const slice = currentTableId && !top.some(t => t.table_id === currentTableId)
    ? [...top, ...items.filter(t => t.table_id === currentTableId)]
    : top
  await Promise.all(slice.map(async t => {
    const [fieldsRes, viewsRes] = await Promise.all([
      API.listFields(token, appToken, t.table_id) as Promise<{ items: Array<{ field_id: string; field_name: string; type: number; property?: { options?: Array<{ name: string }> } }> }>,
      API.listViews(token, appToken, t.table_id) as Promise<{ items: Array<{ view_id: string; view_name: string; view_type: string }> }>,
    ])

    const fields: FieldCtx[] = (fieldsRes.items ?? []).map(f => ({
      fieldId: f.field_id,
      fieldName: f.field_name,
      type: f.type,
      typeName: FIELD_TYPE_NAMES[f.type] ?? `type_${f.type}`,
      options: f.property?.options?.map(o => o.name),
    }))

    const views: ViewCtx[] = (viewsRes.items ?? []).map(v => ({
      viewId: v.view_id,
      viewName: v.view_name,
      viewType: v.view_type,
    }))

    tables.push({ tableId: t.table_id, tableName: t.name, fields, views })
  }))

  // Preserve server order
  tables.sort((a, b) => {
    const ia = slice.findIndex(t => t.table_id === a.tableId)
    const ib = slice.findIndex(t => t.table_id === b.tableId)
    return ia - ib
  })

  return {
    appToken,
    appName: appInfo?.app?.name ?? '',
    tables,
    currentTableId,
    fetchedAt: Date.now(),
  }
}

// ─── Serialize to prompt text ─────────────────────────────────────────────────

export function ctxToPrompt(ctx: BaseCtx): string {
  const lines: string[] = [
    `当前 Base：「${ctx.appName}」 (${ctx.appToken})`,
  ]

  if (ctx.currentTableId) {
    const cur = ctx.tables.find(t => t.tableId === ctx.currentTableId)
    if (cur) lines.push(`用户当前查看：${cur.tableName} (${cur.tableId})`)
  }

  lines.push('\n已读取的表结构：')

  for (const t of ctx.tables) {
    const marker = t.tableId === ctx.currentTableId ? ' ◀ 当前' : ''
    lines.push(`\n• ${t.tableName} (${t.tableId})${marker}`)
    lines.push(`  视图: ${t.views.map(v => `${v.viewName}[${v.viewType}]`).join(', ') || '无'}`)
    lines.push(`  字段 (${t.fields.length}):`)
    for (const f of t.fields) {
      const opts = f.options?.length ? ` — 选项: ${f.options.join(' / ')}` : ''
      lines.push(`    - ${f.fieldName} [${f.typeName}]${opts}  (id: ${f.fieldId})`)
    }
  }

  return lines.join('\n')
}

// ─── Summary for badge ────────────────────────────────────────────────────────

export function ctxSummary(ctx: BaseCtx): string {
  const totalFields = ctx.tables.reduce((s, t) => s + t.fields.length, 0)
  return `${ctx.tables.length} 张表 · ${totalFields} 个字段`
}
