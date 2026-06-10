/**
 * VizSpec — the declarative artifact the LLM emits in the no-remote-code ("Plan B" / store)
 * build, replacing generated JS. It is DATA: the sandbox interpreter (interpret.ts + runSpec)
 * renders it via the bundled ui.* helpers, so nothing from the network is ever executed and
 * the sandbox CSP can drop 'unsafe-eval'. validateSpec() structurally sanitises model output.
 */

export interface Aggregate {
  op: 'count' | 'countDistinct' | 'sum' | 'avg' | 'min' | 'max'
  field?: string
  where?: FilterClause[]
  format?: 'int' | 'float1' | 'float2' | 'percent' | 'currency' | 'raw'
}

export interface FilterClause {
  field: string
  op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in'
  value: string | number | Array<string | number>
}

export interface SeriesSpec {
  dimension: string
  measure?: Aggregate
  sort?: 'value-desc' | 'value-asc' | 'label' | 'none'
  limit?: number
}

export interface ChartSpec {
  kind: 'chart'
  title?: string
  chartType: 'bar' | 'line' | 'pie' | 'scatter'
  series: SeriesSpec
  axis?: { rotateLabels?: boolean; scale?: boolean }
}

export interface RawChartSpec {
  kind: 'rawChart'
  title?: string
  option: Record<string, unknown>
}

export interface KpiSpec { label: string; value: Aggregate }
export interface ColumnSpec { key: string; label?: string; editable?: boolean }
export interface RowActionSpec { label: string; template: string }

export interface TableSpec {
  kind: 'table'
  columns?: ColumnSpec[]
  pageSize?: number
  search?: boolean
  actions?: RowActionSpec[]
}

export interface DashboardSpec {
  kind: 'dashboard'
  title?: string
  filters?: string[]
  kpis?: KpiSpec[]
  charts?: Array<ChartSpec | RawChartSpec>
  table?: { columns?: ColumnSpec[]; pageSize?: number; actions?: RowActionSpec[] }
}

export interface SiteSection {
  type: 'hero' | 'section'
  title?: string
  subtitle?: string
  body?: string
}
export interface SiteSpec {
  kind: 'site'
  title?: string
  sections: SiteSection[]
  dashboard: DashboardSpec
}

/** A slide deck (AI 幻灯片 / 文档转PPT). `slides` are already-sanitized content slides (the
 *  SlideSpec shape the sandbox ui.slides renders); app-constructed, not raw model output. */
export interface SlidesSpec { kind: 'slides'; slides: unknown[] }

export type VizSpec = ChartSpec | RawChartSpec | TableSpec | DashboardSpec | SiteSpec | SlidesSpec

const AGG_OPS = new Set(['count', 'countDistinct', 'sum', 'avg', 'min', 'max'])
const FILTER_OPS = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'in'])
const CHART_TYPES = new Set(['bar', 'line', 'pie', 'scatter'])
const FORMATS = new Set(['int', 'float1', 'float2', 'percent', 'currency', 'raw'])
const clampInt = (n: unknown, lo: number, hi: number, dflt: number) => {
  const v = Math.round(Number(n))
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt
}

/**
 * Sanitise a spec coming from the model: keep only known fields/ops, clamp limits, drop
 * references to fields not in `fields` (so a hallucinated column can't break rendering).
 * Throws a friendly error only when the spec is unusable (bad/missing kind, no valid chart
 * dimension). With no eval, a sanitised spec can at worst render an empty widget.
 */
export function validateSpec(input: unknown, fields: string[] = []): VizSpec {
  // Keep field references as-is — DON'T drop them when they aren't in `fields`. Dropping was
  // the cause of "blank dashboards/sites": one slightly-off field name from the model nuked
  // every chart/kpi. The interpreter degrades gracefully on a missing field (empty group / 0),
  // and correct fields still render. (`fields` is still used to guide the prompt.)
  void fields
  const ok = (_f?: string) => true
  const obj = input as Record<string, unknown>
  if (!obj || typeof obj !== 'object' || typeof obj.kind !== 'string') {
    throw new Error('生成结果不是有效的可视化规格（缺少 kind）。请换一个支持 JSON 输出的模型重试。')
  }

  const cleanFilter = (c: unknown): FilterClause | null => {
    const x = c as FilterClause
    if (!x || typeof x.field !== 'string' || !FILTER_OPS.has(x.op) || !ok(x.field)) return null
    return { field: x.field, op: x.op, value: x.value }
  }
  const cleanAgg = (a: unknown): Aggregate => {
    const x = (a ?? {}) as Aggregate
    const op = AGG_OPS.has(x.op) ? x.op : 'count'
    const where = Array.isArray(x.where) ? x.where.map(cleanFilter).filter(Boolean) as FilterClause[] : undefined
    return {
      op,
      field: ok(x.field) ? x.field : undefined,
      where: where?.length ? where : undefined,
      format: FORMATS.has(x.format as string) ? x.format : undefined,
    }
  }
  const cleanSeries = (s: unknown): SeriesSpec => {
    const x = (s ?? {}) as SeriesSpec
    return {
      dimension: x.dimension,
      measure: x.measure ? cleanAgg(x.measure) : { op: 'count' },
      sort: (['value-desc', 'value-asc', 'label', 'none'] as const).includes(x.sort as never) ? x.sort : 'value-desc',
      limit: x.limit != null ? clampInt(x.limit, 1, 200, 20) : 20,
    }
  }
  const cleanChart = (c: unknown): ChartSpec | RawChartSpec | null => {
    const x = (c ?? {}) as {
      kind?: string; option?: Record<string, unknown>; series?: unknown
      title?: string; chartType?: ChartSpec['chartType']; axis?: ChartSpec['axis']
    }
    if (x.kind === 'rawChart' || (x.option && !x.series)) {
      return x.option && typeof x.option === 'object' ? { kind: 'rawChart', title: x.title, option: x.option } : null
    }
    const series = cleanSeries(x.series)
    if (!series.dimension || !ok(series.dimension)) return null
    return { kind: 'chart', title: x.title, chartType: CHART_TYPES.has(x.chartType as string) ? x.chartType! : 'bar', series, axis: x.axis }
  }
  const cleanCols = (cs: unknown): ColumnSpec[] | undefined =>
    Array.isArray(cs) ? (cs as ColumnSpec[]).filter((c) => c && typeof c.key === 'string' && ok(c.key)) : undefined
  const cleanActions = (as: unknown): RowActionSpec[] | undefined =>
    Array.isArray(as) ? (as as RowActionSpec[]).filter((a) => a && typeof a.label === 'string' && typeof a.template === 'string') : undefined
  const cleanKpis = (ks: unknown): KpiSpec[] | undefined =>
    Array.isArray(ks) ? (ks as KpiSpec[]).filter((k) => k && typeof k.label === 'string').map((k) => ({ label: k.label, value: cleanAgg(k.value) })) : undefined
  const cleanDash = (d: Record<string, unknown>): DashboardSpec => ({
    kind: 'dashboard',
    title: typeof d.title === 'string' ? d.title : undefined,
    filters: Array.isArray(d.filters) ? (d.filters as string[]).filter((f) => typeof f === 'string' && ok(f)) : undefined,
    kpis: cleanKpis(d.kpis),
    charts: Array.isArray(d.charts) ? (d.charts.map(cleanChart).filter(Boolean) as Array<ChartSpec | RawChartSpec>) : undefined,
    table: d.table && typeof d.table === 'object'
      ? { columns: cleanCols((d.table as Record<string, unknown>).columns), pageSize: clampInt((d.table as Record<string, unknown>).pageSize, 1, 100, 20), actions: cleanActions((d.table as Record<string, unknown>).actions) }
      : undefined,
  })

  switch (obj.kind) {
    case 'chart':
    case 'rawChart': {
      const c = cleanChart(obj)
      if (!c) throw new Error('图表规格无效（缺少有效的分组字段或 option）。')
      return c
    }
    case 'table':
      return { kind: 'table', columns: cleanCols(obj.columns), pageSize: clampInt(obj.pageSize, 1, 100, 20), search: obj.search !== false, actions: cleanActions(obj.actions) }
    case 'dashboard':
      return cleanDash(obj)
    case 'slides':
      return { kind: 'slides', slides: Array.isArray(obj.slides) ? obj.slides : [] }
    case 'site': {
      const sections = Array.isArray(obj.sections)
        ? (obj.sections as SiteSection[]).filter((s) => s && (s.type === 'hero' || s.type === 'section'))
          .map((s) => ({ type: s.type, title: s.title, subtitle: s.subtitle, body: s.body }))
        : []
      const dashboard = obj.dashboard && typeof obj.dashboard === 'object' ? cleanDash(obj.dashboard as Record<string, unknown>) : { kind: 'dashboard' as const }
      return { kind: 'site', title: typeof obj.title === 'string' ? obj.title : undefined, sections, dashboard }
    }
    default:
      throw new Error(`未知的可视化规格类型：${String(obj.kind)}`)
  }
}
