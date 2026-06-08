import * as API from '../feishu/api'
import type {
  ScenarioTemplate, TemplateFieldDef,
  ProgressStep, CreationResult,
} from './types'

type OnProgress = (steps: ProgressStep[]) => void
type StepStatus = 'pending' | 'running' | 'done' | 'error'

function resolve(template: string, inputs: Record<string, string>): string {
  return template.replace(/\{\{inputs\.(\w+)\}\}/g, (_, k) => inputs[k] ?? '')
}

/** Convert template field to Feishu API field.
 *  Formula fields (type=20) are passed with formula_expression in property.
 *  Non-formula + non-select fields are passed with empty property to avoid API errors.
 */
function toApiField(f: TemplateFieldDef): API.FeishuField {
  const field: API.FeishuField = {
    field_name: f.name,
    type: f.type as API.FieldType,
  }
  if (f.options?.length) {
    field.property = { options: f.options.map(o => ({ name: o.name, color: o.color ?? 0 })) }
  }
  if (f.formula_expression) {
    field.property = { ...field.property, formula_expression: f.formula_expression }
  }
  if (f.description) {
    field.description = { text: f.description }
  }
  return field
}

// ─── Main execution ───────────────────────────────────────────────────────────

export async function executeTemplate(
  template: ScenarioTemplate,
  inputs: Record<string, string>,
  token: string,
  currentAppToken: string | undefined,
  onProgress: OnProgress,
  /** Optional: create dashboard via browser DOM automation, returns blockToken or null */
  createDashboard?: (name: string) => Promise<string | null>,
  /** Current page URL (used as the "open" link when target=current_app). */
  currentAppUrl?: string,
  /** Deprecated — kept for signature stability. Bases are created as the user now, so
   *  no ownership transfer is performed. */
  _ownerOpenId?: string
): Promise<CreationResult> {

  const hasDashboards = (template.dashboards?.length ?? 0) > 0

  // Build initial step list
  const steps: ProgressStep[] = [
    {
      id: 'app',
      label: template.target === 'new_app'
        ? `创建应用「${resolve(inputs.app_name ?? template.name, inputs)}」`
        : '使用当前应用',
      status: 'pending',
    },
    ...template.tables.flatMap(t => [
      { id: `tbl-${t.ref}`, label: `创建「${resolve(t.name, inputs)}」表`, status: 'pending' as const },
      ...(t.views?.length ? [{ id: `view-${t.ref}`, label: `  添加视图`, status: 'pending' as const }] : []),
      ...(t.sample_records?.length
        ? [{ id: `rec-${t.ref}`, label: `  导入 ${t.sample_records.length} 条示例数据`, status: 'pending' as const }]
        : []),
    ]),
    ...(hasDashboards
      ? [{ id: 'dash', label: `创建并配置仪表盘（${template.dashboards!.length} 个）`, status: 'pending' as const }]
      : []),
  ]

  const set = (id: string, status: StepStatus, detail?: string) => {
    const s = steps.find(s => s.id === id)
    if (s) { s.status = status; if (detail) s.detail = detail }
    onProgress([...steps])
  }

  const tableMap: Record<string, string> = {}       // ref → table_id
  // field ref maps for dashboard resolution: tableRef → fieldName → field_id
  const fieldIdMaps: Record<string, Record<string, string>> = {}
  let appToken: string
  let appName: string
  let appUrl = ''

  // ── Step 1: App ──────────────────────────────────────────────────────────────

  set('app', 'running')
  try {
    if (template.target === 'new_app') {
      appName = resolve(inputs.app_name ?? template.name, inputs)
      // createApp returns the real Base URL on the tenant's domain — use it.
      // Building "https://base.feishu.cn/base/<token>" by hand 404s.
      const res = await API.createApp(token, appName) as { app: { app_token: string; url?: string } }
      appToken = res.app.app_token
      appUrl = res.app.url ?? ''
      // Created with the user's token → already owned by the user; no transfer needed.
    } else {
      if (!currentAppToken) throw new Error('未检测到当前 Base 应用，请先打开一个多维表格页面')
      appToken = currentAppToken
      const info = await API.getApp(token, appToken) as { app: { name: string } }
      appName = info.app.name
      // getApp doesn't return url — reuse the page the user is already on.
      appUrl = currentAppUrl ?? ''
    }
    set('app', 'done')
  } catch (err) {
    set('app', 'error', String(err))
    throw err
  }

  let totalRecords = 0

  // ── Step 2: Tables + Fields + Views + Records ────────────────────────────────

  for (const tableDef of template.tables) {
    const tableName = resolve(tableDef.name, inputs)

    // Relation/lookup fields (18 单向关联 / 19 查找引用 / 21 双向关联) require a
    // `property` pointing at a target table that templates can't express yet —
    // creating them bare fails with "DuplexLink field property is null" and would
    // abort the whole table. Skip them defensively instead of tanking creation.
    const RELATION_TYPES = new Set([18, 19, 21])
    const usable = tableDef.fields.filter(f => {
      if (RELATION_TYPES.has(f.type) && !f.formula_expression) {
        console.warn(`跳过模板「${tableDef.name}」的关联类字段「${f.name}」(type=${f.type})：模板暂不支持需 property 的关联/查找字段`)
        return false
      }
      return true
    })

    // Separate non-formula and formula fields.
    // Formula fields must be added AFTER the fields they reference exist.
    const nonFormula = usable.filter(f => f.type !== 20)
    const formulaFields = usable.filter(f => f.type === 20)

    set(`tbl-${tableDef.ref}`, 'running')
    let tableId: string
    try {
      const res = await API.createTable(
        token, appToken, tableName, nonFormula.map(toApiField)
      ) as { table_id: string }
      tableId = res.table_id
      tableMap[tableDef.ref] = tableId
      fieldIdMaps[tableDef.ref] = {}
      set(`tbl-${tableDef.ref}`, 'done')
    } catch (err) {
      set(`tbl-${tableDef.ref}`, 'error', String(err))
      // Don't lose what's already built — surface the (half-built) Base so the user
      // can open it, see what's there, and补建 or delete it (no silent orphan).
      const built = Object.entries(tableMap).map(([ref, id]) => `${ref}(${id})`).join('、') || '无'
      const link = appUrl ? `\n已建好的应用：${appUrl}` : ''
      throw new Error(
        `创建数据表「${tableName}」失败：${err instanceof Error ? err.message : String(err)}。` +
        `应用和前面的表已创建（${built}），未回滚。${link}\n可打开上面的应用查看，或删除后重试。`
      )
    }

    // Add formula fields individually AFTER other fields exist
    for (const f of formulaFields) {
      try {
        const res = await API.createField(token, appToken, tableId, toApiField(f)) as
          { field?: { field_id: string } } | { field_id?: string }
        const fid = ('field' in res ? res.field?.field_id : undefined) ?? (res as { field_id?: string }).field_id
        if (fid) fieldIdMaps[tableDef.ref][f.name] = fid
      } catch {
        // Formula field creation failure is non-fatal — expression may reference fields differently
      }
    }

    // Build field name → id map from list (most reliable)
    try {
      const fieldsRes = await API.listFields(token, appToken, tableId) as
        { items: Array<{ field_id: string; field_name: string }> }
      for (const f of fieldsRes.items ?? []) {
        fieldIdMaps[tableDef.ref][f.field_name] = f.field_id
      }
    } catch { /* field map is best-effort */ }

    // Views
    if (tableDef.views?.length) {
      set(`view-${tableDef.ref}`, 'running')
      try {
        for (const view of tableDef.views) {
          await API.createView(token, appToken, tableId, view.name, view.type)
        }
        set(`view-${tableDef.ref}`, 'done')
      } catch (err) {
        set(`view-${tableDef.ref}`, 'error', String(err))
      }
    }

    // Sample records — only write to fields that exist and are writable. Feishu
    // rejects the WHOLE batch with FieldNameNotFound (1254045) if any key is
    // unknown, and writing to formula/relation/auto/system fields also errors. So
    // filter against the real field names, dropping (and logging) anything else.
    if (tableDef.sample_records?.length) {
      set(`rec-${tableDef.ref}`, 'running')
      const NON_WRITABLE = new Set([18, 19, 20, 21, 1001, 1002, 1003, 1004, 1005])
      const writable = new Set(
        tableDef.fields
          .filter((f) => !NON_WRITABLE.has(f.type) && f.name in fieldIdMaps[tableDef.ref])
          .map((f) => f.name)
      )
      const dropped = new Set<string>()
      const records = tableDef.sample_records.map((r) => {
        const fields: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(r)) {
          if (writable.has(k)) fields[k] = v
          else dropped.add(k)
        }
        return { fields }
      })
      if (dropped.size) {
        console.warn(`模板「${tableDef.name}」示例数据中丢弃了不可写/不存在的字段：${[...dropped].join('、')}`)
      }
      try {
        // Verify against what was ACTUALLY created, not what we sent — Feishu can
        // create fewer than requested. Report the real count, not a virtual success.
        const res = (await API.batchCreateRecords(token, appToken, tableId, records)) as {
          records?: unknown[]
        }
        const created = res.records?.length ?? records.length
        totalRecords += created
        if (created < records.length) {
          set(`rec-${tableDef.ref}`, 'done', `仅写入 ${created}/${records.length} 条`)
        } else {
          set(`rec-${tableDef.ref}`, 'done')
        }
      } catch (err) {
        set(`rec-${tableDef.ref}`, 'error', String(err))
      }
    }
  }

  // ── Step 3: Dashboards ───────────────────────────────────────────────────────

  const dashboardWarnings: string[] = []
  const dashboardsCreated: string[] = []

  if (hasDashboards) {
    set('dash', 'running')
    try {
      const dashRes = await API.listDashboards(token, appToken) as
        { dashboards?: Array<{ block_token: string; name: string }> }
      const existingDashboards = dashRes.dashboards ?? []

      for (const dash of template.dashboards!) {
        let blockToken: string | null = null

        const existing = existingDashboards.find(d => d.name === dash.name)
        if (existing) {
          blockToken = existing.block_token
        } else if (createDashboard) {
          // Try DOM automation to create the dashboard in the browser
          try {
            blockToken = await createDashboard(dash.name)
            if (blockToken) dashboardsCreated.push(dash.name)
          } catch { /* fall through to warning */ }
        }

        // 飞书 OpenAPI 不支持程序化新建仪表盘或图表（.../dashboards/{id}/blocks 实测 404）。
        // 表/字段/视图/数据都已建好，仪表盘和图表需在飞书里手动添加——这是飞书的限制，
        // 不需要、也不要让用户去查 block_token。
        if (!blockToken) {
          dashboardWarnings.push(`仪表盘「${dash.name}」需在飞书里手动添加（飞书 API 不支持程序化创建仪表盘/图表）`)
          continue
        }
        if (dash.blocks.length > 0) {
          dashboardWarnings.push(`仪表盘「${dash.name}」的图表需在飞书里手动配置（飞书 API 不支持程序化创建图表）`)
        }
      }

      set('dash', 'done',
        dashboardsCreated.length > 0 ? `${dashboardsCreated.length} 个空仪表盘已建，图表需手动配置` :
        dashboardWarnings.length > 0 ? '仪表盘需在飞书里手动加' : '无仪表盘'
      )
    } catch (err) {
      set('dash', 'error', String(err))
      dashboardWarnings.push(String(err))
    }
  }

  return {
    appToken,
    appName,
    appUrl: appUrl || `https://feishu.cn/base/${appToken}`,
    tables: template.tables.map(t => ({
      ref: t.ref,
      name: resolve(t.name, inputs),
      tableId: tableMap[t.ref] ?? '',
    })),
    totalRecords,
    dashboardWarnings,
    dashboardsCreated,
  }
}
