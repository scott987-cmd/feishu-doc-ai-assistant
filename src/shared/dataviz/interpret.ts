/**
 * Pure interpreter for the declarative VizSpec — the no-remote-code ("Plan B") rendering path.
 * Instead of executing LLM-written JS (new Function), the model emits a VizSpec (data, not code)
 * and these pure functions turn it into ECharts options / aggregates. The sandbox's runSpec()
 * dispatches onto ui.* using these. Kept DOM-free so it's fully unit-testable.
 */
import type { Aggregate, FilterClause, SeriesSpec, ChartSpec } from './spec'

type Row = Record<string, string>

/** Parse a cell string ("1,234.5" / "¥100" / "85%") to a number; NaN when non-numeric.
 *  Uses strict Number() (not parseFloat) so dates/ranges/multi-sign strings ('2024-01', '1-3',
 *  '1.2.3') become NaN and are EXCLUDED from sums/avgs instead of yielding garbage. */
export function num(v: unknown): number {
  if (typeof v === 'number') return v
  const s = String(v ?? '').replace(/[^\d.\-]/g, '')
  if (!s || s === '-' || s === '.') return NaN
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

const asNum = (v: unknown) => { const n = num(v); return Number.isFinite(n) ? n : null }

/** Evaluate one filter clause against a row. */
function matchClause(row: Row, c: FilterClause): boolean {
  const cell = row[c.field] ?? ''
  switch (c.op) {
    case 'eq':  return String(cell) === String(c.value)
    case 'ne':  return String(cell) !== String(c.value)
    case 'contains': return String(cell).includes(String(c.value))
    case 'in':  { const arr = Array.isArray(c.value) ? c.value : [c.value]; return arr.map(String).includes(String(cell)) }
    case 'gt': case 'gte': case 'lt': case 'lte': {
      const a = asNum(cell), b = asNum(c.value)
      if (a === null || b === null) return false
      return c.op === 'gt' ? a > b : c.op === 'gte' ? a >= b : c.op === 'lt' ? a < b : a <= b
    }
    default: return false
  }
}

/** AND-join clauses (empty/undefined → all rows pass). */
export function evalFilter(row: Row, clauses?: FilterClause[]): boolean {
  if (!clauses?.length) return true
  return clauses.every((c) => matchClause(row, c))
}

/** Compute one aggregate over rows (after its optional `where`). */
export function evalAggregate(rows: Row[], agg: Aggregate): number {
  const sel = agg.where ? rows.filter((r) => evalFilter(r, agg.where)) : rows
  if (agg.op === 'count') return sel.length
  if (agg.op === 'countDistinct') {
    const f = agg.field
    return f ? new Set(sel.map((r) => String(r[f] ?? ''))).size : 0
  }
  const f = agg.field
  if (!f) return 0
  const nums = sel.map((r) => asNum(r[f])).filter((n): n is number => n !== null)
  if (!nums.length) return 0
  switch (agg.op) {
    case 'sum': return nums.reduce((a, b) => a + b, 0)
    case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length
    case 'min': return Math.min(...nums)
    case 'max': return Math.max(...nums)
    default: return 0
  }
}

/** Format an aggregate result for display (KPI cards). */
export function formatValue(n: number, fmt?: Aggregate['format']): string {
  switch (fmt) {
    case 'float1': return n.toFixed(1)
    case 'float2': return n.toFixed(2)
    case 'percent': return `${n.toFixed(1)}%`
    case 'currency': return `¥${Math.round(n).toLocaleString()}`
    case 'raw': return String(n)
    case 'int':
    default: return Math.round(n).toLocaleString()
  }
}

/** Group rows by `series.dimension`, aggregate `series.measure` per group → labeled points. */
export function groupSeries(rows: Row[], series: SeriesSpec): Array<{ label: string; value: number }> {
  const groups = new Map<string, Row[]>()
  for (const r of rows) {
    const key = String(r[series.dimension] ?? '—')
    ;(groups.get(key) ?? groups.set(key, []).get(key)!).push(r)
  }
  const measure: Aggregate = series.measure ?? { op: 'count' }
  let out = Array.from(groups, ([label, rs]) => ({ label, value: evalAggregate(rs, measure) }))
  const sort = series.sort ?? 'value-desc'
  if (sort === 'value-desc') out.sort((a, b) => b.value - a.value)
  else if (sort === 'value-asc') out.sort((a, b) => a.value - b.value)
  else if (sort === 'label') out.sort((a, b) => a.label.localeCompare(b.label))
  if (series.limit && series.limit > 0) out = out.slice(0, series.limit)
  return out
}

/** Build a self-contained ECharts option from a ChartSpec (no eval; ECharts.setOption is data). */
export function buildOption(rows: Row[], spec: ChartSpec): Record<string, unknown> {
  const pts = groupSeries(rows, spec.series)
  const labels = pts.map((p) => p.label)
  const values = pts.map((p) => p.value)
  const title = spec.title ? { title: { text: spec.title, left: 'center', textStyle: { fontSize: 14 } } } : {}

  if (spec.chartType === 'pie') {
    return {
      ...title,
      tooltip: { trigger: 'item' },
      legend: { bottom: 0, type: 'scroll' },
      series: [{ type: 'pie', radius: ['40%', '70%'], data: pts.map((p) => ({ name: p.label, value: p.value })) }],
    }
  }
  if (spec.chartType === 'scatter') {
    return {
      ...title,
      tooltip: {},
      xAxis: { type: 'category', data: labels, axisLabel: { rotate: spec.axis?.rotateLabels ? 35 : 0 } },
      yAxis: { type: 'value', scale: !!spec.axis?.scale },
      series: [{ type: 'scatter', data: values.map((v, i) => [i, v]) }],
    }
  }
  // bar / line
  return {
    ...title,
    tooltip: { trigger: 'axis' },
    grid: { left: 48, right: 24, bottom: spec.axis?.rotateLabels ? 70 : 40, top: spec.title ? 48 : 24 },
    xAxis: { type: 'category', data: labels, axisLabel: { rotate: spec.axis?.rotateLabels ? 35 : 0 } },
    yAxis: { type: 'value', scale: !!spec.axis?.scale },
    series: [{ type: spec.chartType, data: values, smooth: spec.chartType === 'line' }],
  }
}

/** Render a row-action title from a "{field} …" template (replaces model-written build(row)). */
export function actionTemplate(row: Row, template: string): string {
  return template.replace(/\{([^}]+)\}/g, (_, k) => String(row[String(k).trim()] ?? '').trim())
}
