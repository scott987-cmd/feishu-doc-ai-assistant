import * as API from './api'
import type {
  ScenarioTemplate, TemplateTableDef, TemplateFieldDef, TemplateViewDef,
  TemplateDashboard,
} from '../templates/types'

// ─── Field types to skip ──────────────────────────────────────────────────────
// SingleLink (18) / Lookup (19) / DuplexLink (21): reference cross-table IDs that
// won't exist in a new Base (and need a `property` the template can't express).
// System fields (1001-1004): CreatedTime/ModifiedTime/CreatedBy/ModifiedBy are auto-generated
// Formula (20) IS intentionally kept — expressions use field names e.g. "[数量]*[单价]"
const SKIP_TYPES = new Set([18, 19, 21, 1001, 1002, 1003, 1004])

// ─── API shapes ───────────────────────────────────────────────────────────────

interface ApiFieldOption { id?: string; name: string; color?: number }

interface ApiField {
  field_id: string
  field_name: string
  type: number
  property?: {
    options?: ApiFieldOption[]
    formatter?: string
    date_formatter?: string
    number_exceeds?: string
    formula_expression?: string
  }
  description?: { text?: string }
}

interface ApiView { view_id: string; view_name: string; view_type: string }
interface ApiDashboard { block_token: string; name: string }

// ─── Main export ──────────────────────────────────────────────────────────────

export async function exportBaseAsTemplate(
  token: string,
  appToken: string
): Promise<ScenarioTemplate> {
  const appInfo = await API.getApp(token, appToken) as { app: { name: string } }
  const appName = appInfo.app.name

  const tablesRes = await API.listTables(token, appToken) as { items: Array<{ table_id: string; name: string }> }
  const tableItems = tablesRes.items ?? []

  // ── Tables ──────────────────────────────────────────────────────────────────

  const tableDefs: TemplateTableDef[] = await Promise.all(
    tableItems.map(async t => {
      const ref = toRef(t.name)

      const [fieldsRes, viewsRes] = await Promise.all([
        API.listFields(token, appToken, t.table_id) as Promise<{ items: ApiField[] }>,
        API.listViews(token, appToken, t.table_id) as Promise<{ items: ApiView[] }>,
      ])

      const fields: TemplateFieldDef[] = (fieldsRes.items ?? [])
        .filter(f => !SKIP_TYPES.has(f.type))
        .map(mapField)

      // Formula fields must come AFTER the fields they reference
      const nonFormula = fields.filter(f => f.type !== 20)
      const formula = fields.filter(f => f.type === 20)

      const views: TemplateViewDef[] = (viewsRes.items ?? []).map(v => ({
        name: v.view_name,
        type: v.view_type as TemplateViewDef['type'],
      }))

      return {
        ref,
        name: t.name,
        fields: [...nonFormula, ...formula],
        views,
        sample_records: [],
      }
    })
  )

  // ── Dashboards ──────────────────────────────────────────────────────────────

  const dashboards = await exportDashboards(token, appToken)

  // ── Assemble template ───────────────────────────────────────────────────────

  const totalViews = tableDefs.reduce((s, t) => s + (t.views?.length ?? 0), 0)

  return {
    id: toRef(appName),
    name: appName,
    description: `从「${appName}」导出的模版`,
    icon: '📊',
    category: '自定义',
    tags: [],
    version: '1.0.0',
    author: '',
    source: 'remote',
    target: 'new_app',
    preview: {
      tables: tableDefs.length,
      views: totalViews,
      records: 0,
      dashboards: dashboards.length,
    },
    inputs: [
      {
        key: 'app_name',
        label: '应用名称',
        type: 'text',
        default: appName,
        placeholder: appName,
        required: true,
      },
    ],
    tables: tableDefs,
    ...(dashboards.length > 0 ? { dashboards } : {}),
  }
}

// ─── Dashboard export ─────────────────────────────────────────────────────────

async function exportDashboards(
  token: string,
  appToken: string
): Promise<TemplateDashboard[]> {
  let dashboardList: ApiDashboard[] = []
  try {
    const res = await API.listDashboards(token, appToken) as { dashboards?: ApiDashboard[] }
    dashboardList = res.dashboards ?? []
  } catch {
    return []
  }

  const results: TemplateDashboard[] = []

  for (const dash of dashboardList) {
    // 飞书无"读取仪表盘图表"API（.../dashboards/{id}/blocks 实测 404），
    // 无法导出图表配置 —— 只能导出仪表盘名称，blocks 留空。
    results.push({ name: dash.name, blocks: [] })
  }

  return results
}


// ─── Field mapper ─────────────────────────────────────────────────────────────

function mapField(f: ApiField): TemplateFieldDef {
  const def: TemplateFieldDef = { name: f.field_name, type: f.type }

  if (f.property?.options?.length) {
    def.options = f.property.options.map(o => ({
      name: o.name,
      ...(o.color !== undefined ? { color: o.color } : {}),
    }))
  }

  if (f.property?.formula_expression) {
    def.formula_expression = f.property.formula_expression
  }

  if (f.description?.text) {
    def.description = f.description.text
  }

  return def
}

// ─── Download ─────────────────────────────────────────────────────────────────

export function downloadTemplateJSON(template: ScenarioTemplate): string {
  const json = JSON.stringify(template, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${toRef(template.name) || 'template'}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  return a.download
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function toRef(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  if (!ascii) {
    let h = 0
    for (let i = 0; i < name.length; i++) h = Math.imul(31, h) + name.charCodeAt(i)
    return 'tbl-' + (h >>> 0).toString(36)
  }
  return ascii
}
