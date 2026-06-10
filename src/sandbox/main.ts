/**
 * Sandbox runtime for the data-viz overlay.
 *
 * Runs in an MV3 sandbox page: null/opaque origin, NO chrome.* APIs, and a locked CSP with
 * `connect-src 'none'` (see vite.config.ts `sandboxCsp`). It receives a render-function body
 * (LLM-generated) + the table data via postMessage and executes it with the bundled ECharts.
 * Even though it `eval`s generated code, the code cannot reach the network, the extension's
 * tokens/storage, or the Feishu page DOM — the worst case is a broken chart in this frame.
 */
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts'
import {
  GridComponent, TooltipComponent, LegendComponent, TitleComponent,
  DatasetComponent, DataZoomComponent, ToolboxComponent, VisualMapComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { vizAccent } from '../shared/theme'

echarts.use([
  BarChart, LineChart, PieChart, ScatterChart,
  GridComponent, TooltipComponent, LegendComponent, TitleComponent,
  DatasetComponent, DataZoomComponent, ToolboxComponent, VisualMapComponent,
  CanvasRenderer,
])

import type { VizSpec, DashboardSpec, ChartSpec as VizChartSpec, RawChartSpec } from '../shared/dataviz/spec'
import { buildOption, evalAggregate, formatValue, actionTemplate } from '../shared/dataviz/interpret'

// No-remote-code path: render a declarative VizSpec via the bundled interpreter (no eval).
// When VITE_WEBSTORE=1 this const is statically true → Vite dead-code-eliminates every legacy
// execViz/execInto branch below, so the store bundle contains no `new Function(` at all.
const NO_EVAL = import.meta.env.VITE_WEBSTORE === '1' || import.meta.env.VITE_WEBSTORE === 'true'

type RenderMsg = {
  type: 'DATAVIZ_RENDER'
  nonce: string
  /** Legacy: LLM-generated render JS (self-distribution builds only). */
  code?: string
  /** Plan B: declarative spec rendered by runSpec (store / no-remote-code builds). */
  spec?: VizSpec
  data: Array<Record<string, unknown>>
  /** Named sub-tables for multi-sheet sites (name → rows). `data` is the primary one. */
  datasets?: Record<string, Array<Record<string, unknown>>>
  theme?: 'light' | 'dark'
  /** Present only for a single-table Base render → enables editable cells / write-back. */
  source?: { kind: 'base'; appToken: string; tableId: string }
  /** fieldName → Feishu typeName, for coercing edited cells back to the right JSON type on write-back. */
  fieldTypes?: Record<string, string>
}

const root = document.getElementById('root') as HTMLDivElement
const errEl = document.getElementById('err') as HTMLPreElement

// The generated code may create MANY echarts instances (a multi-chart dashboard, each in
// its own grid cell). Walk the DOM to dispose/resize all of them.
function eachChart(fn: (c: echarts.ECharts) => void) {
  for (const el of [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]) {
    const inst = echarts.getInstanceByDom(el)
    if (inst) fn(inst)
  }
}
function showError(msg: string) {
  eachChart((c) => c.dispose())
  root.style.display = 'none'
  errEl.style.display = 'block'
  errEl.textContent = '⚠ 渲染失败：\n' + msg
}

// ── User-adjustable accent color (PPT / 网站 / 看板 / 图表) ───────────────────
// The overlay's 🎨 control posts DATAVIZ_ACCENT; we re-theme the design-system vars (--p…) and
// the chart palette live. Persists across re-renders (a regenerate keeps the chosen color).
const DEFAULT_PALETTE = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc']
let accentHex: string | null = null
let chartColors: string[] | null = null
/** Apply (hex) or reset (null) the accent. Recomputed for the current light/dark mode. */
function applyAccent(hex: string | null): void {
  accentHex = hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : null
  const r = document.documentElement, isDark = r.dataset.theme === 'dark'
  if (accentHex) {
    const a = vizAccent(accentHex, isDark)
    r.style.setProperty('--p', a.p); r.style.setProperty('--p-strong', a.strong); r.style.setProperty('--p-soft', a.soft)
    chartColors = a.palette
  } else {
    r.style.removeProperty('--p'); r.style.removeProperty('--p-strong'); r.style.removeProperty('--p-soft')
    chartColors = null
  }
  // Recolor existing charts (incl. ones the generated code init'd directly, not via ui.chart).
  eachChart((c) => { try { (c.setOption as (o: unknown, b?: boolean) => void)({ color: chartColors ?? DEFAULT_PALETTE }, false) } catch { /* */ } })
}
/** Re-apply the accent for the current theme (after a theme toggle or a re-render). */
function reapplyAccent(): void { if (accentHex) applyAccent(accentHex) }

// ── Reliable UI helpers handed to generated "site" code ─────────────────────
// The error-prone interactive bits (a data grid that fills from `data` with working
// search/sort/pagination; tab switching) are OUR code, not the model's — so a generated
// site ACTUALLY WORKS instead of rendering empty rows / dead buttons.
const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
const cellStr = (v: unknown) => (v == null ? '' : String(v))

// ── Write-back drafts ───────────────────────────────────────────────────────
// Editable cells accumulate here keyed by record_id (the hidden __rid on each Base row).
// Nothing is written until the user clicks "提交" on the overlay chrome (page side) → parent
// → background → batchUpdateRecords. The generated code NEVER writes; it only declares which
// columns are `editable`, and that only takes effect when the host enabled it (Base single-table).
let editEnabled = false
let lastNonce = ''
const drafts = new Map<string, Record<string, string>>()

// Per-column Feishu field type (fieldName → typeName, e.g. 'Number'/'Checkbox'/'DateTime'),
// passed in with an editable single-table Base render. Used to coerce staged string cells back
// to the JSON types batch_update requires — without it every edit went as a string and a single
// Number/Checkbox/Date field rejected the WHOLE batch (taking unrelated text edits down with it).
let fieldTypes: Record<string, string> = {}
function coerceCell(type: string | undefined, v: string): unknown {
  if (type === 'Number') { if (v.trim() === '') return null; const n = Number(v); return Number.isFinite(n) ? n : v }
  if (type === 'Checkbox') return v === 'true' || v === 'TRUE' || v === '1' || v === '是' || v === '✓'
  if (type === 'DateTime') {
    const s = v.trim(); if (s === '') return null
    // Date-only Y[-/.]M[-/.]D (the formats inferColType accepts, incl. dots which Date.parse rejects)
    // → UTC midnight, so we don't depend on Date.parse's locale handling or shift by the tz offset.
    const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3])
    const t = Date.parse(s) // ISO datetimes etc.
    return Number.isFinite(t) ? t : v
  }
  return v // Text / Single-Select / etc. stay as strings (already accepted)
}

/** Edits as Feishu's batch_update shape: [{record_id, fields:{...}}], type-coerced per column. */
function draftEdits(): Array<{ record_id: string; fields: Record<string, unknown> }> {
  return Array.from(drafts, ([record_id, fields]) => ({
    record_id,
    fields: Object.fromEntries(Object.entries(fields).map(([k, val]) => [k, coerceCell(fieldTypes[k], val)])),
  }))
}
/** Tell the overlay how many rows have pending edits (it shows/hides its 提交 button). */
function notifyDirty(): void {
  window.parent.postMessage({ type: 'DATAVIZ_DIRTY', nonce: lastNonce, edits: draftEdits() }, '*')
}
/** Record one cell edit: mutate the in-memory row (so it survives repaint) + stage the draft. */
function applyEdit(rows: Rows, rid: string, key: string, value: string): void {
  const row = rows.find((r) => cellStr(r.__rid) === rid)
  if (row) row[key] = value
  drafts.set(rid, { ...(drafts.get(rid) ?? {}), [key]: value })
  notifyDirty()
}

/** A per-row quick action — the model supplies a pure `build(row) → 任务标题`; clicking it asks
 *  the host to create a task as the user. Only shown in editable (single-table Base) mode. */
interface RowAction { label: string; build: (row: Record<string, unknown>) => string }
interface TableOpts { columns?: Array<{ key: string; label?: string; editable?: boolean }>; pageSize?: number; search?: boolean; actions?: RowAction[] }
type Rows = Array<Record<string, unknown>>
interface KpiSpec { label: string; calc: (rows: Rows) => unknown }
interface ChartSpec { title?: string; build: (rows: Rows) => unknown }
interface DashSpec {
  data?: Rows
  filters?: string[]
  kpis?: KpiSpec[]
  charts?: ChartSpec[]
  columns?: Array<{ key: string; label?: string; editable?: boolean }>
  pageSize?: number
  actions?: RowAction[]
}
/** One slide of a deck (AI 幻灯片 / 文档转PPT). The model supplies only CONTENT per `layout`;
 *  OUR ui.slides renders the deck + paging reliably. */
interface SlideSpec {
  layout?: 'title' | 'section' | 'bullets' | 'two-col' | 'quote' | 'stats' | 'chart' | 'embed'
  title?: string
  subtitle?: string
  bullets?: string[]
  bullets2?: string[]
  quote?: string
  by?: string
  stats?: Array<{ num?: string; label?: string }>
  /** layout:'chart' — a self-contained ECharts option (rendered via ui.chart). */
  chart?: unknown
  /** layout:'embed' — a saved 看板's render code, executed live against `rows` in the slide. */
  code?: string
  /** layout:'embed' — Plan B: declarative spec rendered via runSpec (no eval). */
  spec?: VizSpec
}

/** Dispatch a per-row quick action up to the host (→ background → createTask as the user). */
function dispatchRowAction(rows: Rows, rid: string, action: RowAction): void {
  const row = rows.find((r) => cellStr(r.__rid) === rid)
  if (!row) return
  let summary = ''
  try { summary = String(action.build(row) ?? '').trim() } catch { summary = '' }
  if (summary) window.parent.postMessage({ type: 'DATAVIZ_ROW_ACTION', nonce: lastNonce, action: { kind: 'task', summary } }, '*')
}

// ui.slides auto-play interval — module-scoped so render() can stop it before a re-render (the
// slide DOM is replaced, but a JS interval would keep firing on detached nodes otherwise).
let slidesTimer: ReturnType<typeof setInterval> | null = null
// Removes ui.slides' before/afterprint listeners (PDF export builds a print stack) on re-render.
let slidesPrintCleanup: (() => void) | null = null
// Set by ui.slides so the DATAVIZ_PRINT handler can build the one-slide-per-page stack SYNCHRONOUSLY
// right before window.print() (don't rely on the beforeprint event firing in the sandboxed iframe).
let slidesPrint: { build: () => void; clear: () => void } | null = null

const ui = {
  /** Interactive data table (search + sortable headers + pagination) over ALL of `rows`. */
  table(el: HTMLElement, rows: Array<Record<string, unknown>>, opts: TableOpts = {}): void {
    if (!el) return
    const data = Array.isArray(rows) ? rows : []
    const rawCols: Array<{ key: string; label?: string; editable?: boolean }> = opts.columns && opts.columns.length
      ? opts.columns : Object.keys(data[0] || {}).filter((k) => k !== '__rid').map((k) => ({ key: k }))
    const cols = rawCols.map((c) => ({ key: c.key, label: c.label ?? c.key, editable: c.editable }))
    const acts = editEnabled && Array.isArray(opts.actions) ? opts.actions : []
    const span = cols.length + (acts.length ? 1 : 0)
    const pageSize = opts.pageSize && opts.pageSize > 0 ? opts.pageSize : 50
    // Precompute small value-sets for editable columns → render a <select> (status-like fields);
    // larger/free-text columns fall back to a text <input>. Only when the host enabled editing.
    const editOpts: Record<string, string[] | null> = {}
    if (editEnabled) for (const c of cols) if (c.editable) {
      const s = new Set<string>()
      for (const r of data) { const v = cellStr(r[c.key]); if (v) s.add(v); if (s.size > 50) break }
      editOpts[c.key] = s.size > 0 && s.size <= 50 ? Array.from(s).sort((a, b) => a.localeCompare(b, 'zh')) : null
    }
    const editCell = (key: string, rid: string, cur: string, list: string[] | null): string => {
      const a = `class="input uied" data-rid="${esc(rid)}" data-key="${esc(key)}"`
      if (list) return `<select ${a}>` +
        (list.includes(cur) ? '' : `<option value="${esc(cur)}" selected>${esc(cur)}</option>`) +
        list.map((o) => `<option value="${esc(o)}"${o === cur ? ' selected' : ''}>${esc(o)}</option>`).join('') + '</select>'
      return `<input ${a} value="${esc(cur)}">`
    }
    let q = '', sortKey = '', sortDir = 1, page = 0

    el.innerHTML =
      (opts.search === false ? '' : '<div class="toolbar"><input class="search" placeholder="搜索…"></div>') +
      '<div class="table-wrap"><table class="table"><thead><tr class="uih"></tr></thead><tbody class="uib"></tbody></table></div>' +
      '<div class="muted mt uic"></div><div class="pagination uip"></div>'
    const headEl = el.querySelector('.uih') as HTMLElement
    const bodyEl = el.querySelector('.uib') as HTMLElement
    const countEl = el.querySelector('.uic') as HTMLElement
    const pagerEl = el.querySelector('.uip') as HTMLElement

    function compute(): Array<Record<string, unknown>> {
      let r = data
      if (q) { const lo = q.toLowerCase(); r = r.filter((row) => cols.some((c) => cellStr(row[c.key]).toLowerCase().includes(lo))) }
      if (sortKey) {
        r = r.slice().sort((a, b) => {
          const av = cellStr(a[sortKey]), bv = cellStr(b[sortKey])
          const an = Number(av.replace(/[,¥$%\s]/g, '')), bn = Number(bv.replace(/[,¥$%\s]/g, ''))
          const cmp = av && bv && Number.isFinite(an) && Number.isFinite(bn) ? an - bn : av.localeCompare(bv, 'zh')
          return cmp * sortDir
        })
      }
      return r
    }
    function pageBtns(cur: number, pages: number): string {
      const b = (p: number, label: string, dis = false, active = false) => `<button class="page${active ? ' active' : ''}" data-p="${p}"${dis ? ' disabled' : ''}>${label}</button>`
      let s = b(cur - 1, '‹', cur === 0)
      const from = Math.max(0, cur - 2), to = Math.min(pages - 1, cur + 2)
      if (from > 0) s += b(0, '1') + (from > 1 ? '<span class="muted">…</span>' : '')
      for (let p = from; p <= to; p++) s += b(p, String(p + 1), false, p === cur)
      if (to < pages - 1) s += (to < pages - 2 ? '<span class="muted">…</span>' : '') + b(pages - 1, String(pages))
      return s + b(cur + 1, '›', cur === pages - 1)
    }
    function repaint(): void {
      const filtered = compute()
      const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
      if (page >= pages) page = pages - 1
      const slice = filtered.slice(page * pageSize, page * pageSize + pageSize)
      headEl.innerHTML = cols.map((c) => `<th class="sortable" data-k="${esc(c.key)}">${esc(c.label)}${sortKey === c.key ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')
        + (acts.length ? '<th>操作</th>' : '')
      bodyEl.innerHTML = slice.length
        ? slice.map((row) => {
          const rid = cellStr(row.__rid)
          const cells = cols.map((c) =>
            (editEnabled && c.editable && rid)
              ? `<td>${editCell(c.key, rid, cellStr(row[c.key]), editOpts[c.key])}</td>`
              : `<td>${esc(cellStr(row[c.key]))}</td>`).join('')
          const actCell = acts.length
            ? `<td>${acts.map((a, ai) => `<button class="btn uiact" data-rid="${esc(rid)}" data-ai="${ai}">${esc(a.label)}</button>`).join(' ')}</td>`
            : ''
          return '<tr>' + cells + actCell + '</tr>'
        }).join('')
        : `<tr><td colspan="${span}" class="empty">无匹配数据</td></tr>`
      countEl.textContent = `共 ${filtered.length} 行` + (filtered.length !== data.length ? `（全部 ${data.length}）` : '')
      pagerEl.innerHTML = pages > 1 ? pageBtns(page, pages) : ''
    }
    // Event delegation on `el` (survives the tbody/header re-renders inside it).
    const searchEl = el.querySelector('.search') as HTMLInputElement | null
    if (searchEl) searchEl.addEventListener('input', () => { q = searchEl.value; page = 0; repaint() })
    // Editable cells: commit on `change` (fires on blur / select) — before any repaint, so the
    // edit lands in both the in-memory row and the draft. Delegated so it survives re-renders.
    // The dashboard calls ui.table(el, …) on the SAME element on every filter change. Listeners
    // bound to `el` itself survive the `el.innerHTML = …` reset above, so without detaching the
    // previous call's handlers they STACK — one cell edit would fire applyEdit N times and one
    // row-action button would create the same task N times. Drop the prior pair before re-binding.
    type UiHandlers = { change: EventListener; click: EventListener }
    const elH = el as unknown as { __uiHandlers?: UiHandlers }
    if (elH.__uiHandlers) { el.removeEventListener('change', elH.__uiHandlers.change); el.removeEventListener('click', elH.__uiHandlers.click) }
    const onChange: EventListener = (e) => {
      const t = (e.target as HTMLElement).closest('.uied') as HTMLInputElement | HTMLSelectElement | null
      if (t && t.dataset.rid && t.dataset.key) applyEdit(data, t.dataset.rid, t.dataset.key, t.value)
    }
    const onClick: EventListener = (e) => {
      const act = (e.target as HTMLElement).closest('.uiact') as HTMLButtonElement | null
      if (act && act.dataset.rid != null && act.dataset.ai != null) { const a = acts[Number(act.dataset.ai)]; if (a) dispatchRowAction(data, act.dataset.rid, a); return }
      const th = (e.target as HTMLElement).closest('th.sortable') as HTMLElement | null
      if (th && th.dataset.k) { if (sortKey === th.dataset.k) sortDir = -sortDir; else { sortKey = th.dataset.k; sortDir = 1 } page = 0; repaint(); return }
      const pg = (e.target as HTMLElement).closest('.page') as HTMLButtonElement | null
      if (pg && !pg.disabled) { page = Number(pg.dataset.p); repaint() }
    }
    elH.__uiHandlers = { change: onChange, click: onClick }
    el.addEventListener('change', onChange)
    el.addEventListener('click', onClick)
    repaint()
  },
  /** Draw an ECharts option into `el`; disposes any prior instance so re-renders don't leak. */
  chart(el: HTMLElement, option: unknown): echarts.ECharts | null {
    if (!el) return null
    const prev = echarts.getInstanceByDom(el); if (prev) prev.dispose()
    const c = echarts.init(el)
    // Inject the user-chosen accent palette when the option doesn't already pin its own colors.
    const opt = (option && typeof option === 'object') ? option as Record<string, unknown> : {}
    const themed = chartColors && opt.color == null ? { ...opt, color: chartColors } : opt
    try { (c.setOption as (o: unknown) => void)(themed) } catch { /* bad option → empty chart, page survives */ }
    return c
  },
  /**
   * Reactive dashboard — the reliable way to give a generated site real interactivity. Renders a
   * filter bar (one <select> per field); on change it recomputes the KPI cards + charts + table
   * from the FILTERED rows. The model supplies only PURE reducers (rows → value / echarts option);
   * OUR code wires every interaction, so it actually works (no model-written event handling).
   */
  dashboard(el: HTMLElement, spec: DashSpec = {}): void {
    if (!el) return
    const data: Rows = Array.isArray(spec.data) ? spec.data : []
    const fields = Array.isArray(spec.filters) ? spec.filters.filter(Boolean) : []
    const kpis = Array.isArray(spec.kpis) ? spec.kpis : []
    const charts = Array.isArray(spec.charts) ? spec.charts : []
    const sel: Record<string, string> = {}

    const distinct = (f: string): string[] => {
      const s = new Set<string>()
      for (const r of data) { const v = cellStr(r[f]); if (v) s.add(v) }
      return Array.from(s).sort((a, b) => a.localeCompare(b, 'zh')).slice(0, 500)
    }

    el.innerHTML =
      (fields.length ? '<div class="toolbar uidf"></div>' : '') +
      (kpis.length ? '<div class="grid grid--4 uidk mt"></div>' : '') +
      (charts.length ? '<div class="grid grid--2 uidc mt"></div>' : '') +
      '<div class="uidt mt"></div>'
    const fbar = el.querySelector('.uidf') as HTMLElement | null
    const kbox = el.querySelector('.uidk') as HTMLElement | null
    const cbox = el.querySelector('.uidc') as HTMLElement | null
    const tbox = el.querySelector('.uidt') as HTMLElement | null

    if (fbar) {
      fbar.innerHTML = fields.map((f) =>
        `<select class="input uidsel" data-f="${esc(f)}"><option value="">${esc(f)}：全部</option>` +
        distinct(f).map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('') + '</select>').join('')
      fbar.addEventListener('change', (e) => {
        const s = (e.target as HTMLElement).closest('.uidsel') as HTMLSelectElement | null
        if (!s || !s.dataset.f) return
        sel[s.dataset.f] = s.value
        apply()
      })
    }

    const chartEls: HTMLElement[] = []
    if (cbox) {
      cbox.innerHTML = charts.map((c, i) =>
        `<div class="card"><div class="card-title">${esc(c.title || '图表')}</div><div class="uidch" data-i="${i}" style="height:300px"></div></div>`).join('')
      cbox.querySelectorAll<HTMLElement>('.uidch').forEach((d) => chartEls.push(d))
    }

    const filtered = (): Rows => data.filter((r) => fields.every((f) => !sel[f] || cellStr(r[f]) === sel[f]))

    function apply(): void {
      const rows = filtered()
      if (kbox) kbox.innerHTML = kpis.map((k) => {
        let val = '—'
        try { val = cellStr(k.calc ? k.calc(rows) : '') } catch { /* one bad reducer can't break the page */ }
        return `<div class="stat"><div class="num">${esc(val)}</div><div class="label">${esc(k.label || '')}</div></div>`
      }).join('')
      charts.forEach((c, i) => {
        const ce = chartEls[i]; if (!ce) return
        let opt: unknown = {}
        try { opt = c.build ? c.build(rows) : {} } catch { opt = {} }
        ui.chart(ce, opt)
      })
      if (tbox) ui.table(tbox, rows, { columns: spec.columns, pageSize: spec.pageSize, actions: spec.actions })
    }
    apply()
  },
  /** Tabbed sections. items: [{label, render(panel)}] — clicking a tab re-renders the panel. */
  tabs(el: HTMLElement, items: Array<{ label: string; render: (panel: HTMLElement) => void }>): void {
    if (!el || !items || !items.length) return
    const bar = document.createElement('div'); bar.className = 'tabs'
    const host = document.createElement('div'); host.className = 'mt'
    const show = (i: number) => {
      Array.from(bar.children).forEach((c, j) => c.classList.toggle('active', j === i))
      const p = document.createElement('div'); host.replaceChildren(p)
      try { items[i].render(p) } catch (e) { p.textContent = e instanceof Error ? e.message : String(e) }
    }
    items.forEach((it, i) => { const t = document.createElement('div'); t.className = 'tab'; t.textContent = it.label; t.onclick = () => show(i); bar.appendChild(t) })
    el.replaceChildren(bar, host)
    show(0)
  },
  /**
   * Slide deck (AI 幻灯片 / 文档转PPT). The model supplies an array of CONTENT slides; OUR code
   * renders a real, paged presentation: prev/next + ‹›/space/Home/End keys + click left/right of a
   * slide to page, a dot strip to jump, and a print-stack so the overlay's 🖨 exports ALL pages as PDF.
   */
  slides(el: HTMLElement, list: SlideSpec[], rows?: Rows): void {
    if (!el) return
    const data = (Array.isArray(list) ? list : []).filter(Boolean)
    if (!data.length) { el.innerHTML = '<div class="empty">没有可展示的幻灯片</div>'; return }
    const n = data.length
    const tableRows: Rows = Array.isArray(rows) ? rows : [] // for embed (saved 看板) slides
    const bl = (arr?: string[]) => `<ul class="s-bullets">${(arr ?? []).map((b) => `<li>${esc(cellStr(b))}</li>`).join('')}</ul>`
    const body = (s: SlideSpec): string => {
      const title = s.title ? `<div class="s-title">${esc(s.title)}</div>` : ''
      const head = s.title ? `<div class="s-head">${esc(s.title)}</div>` : ''
      const sub = s.subtitle ? `<div class="s-sub">${esc(s.subtitle)}</div>` : ''
      switch (s.layout) {
        case 'title': return title + sub
        case 'section': return `<div class="s-section-num">SECTION</div>${title}${sub}`
        case 'quote': return `<div class="s-quote">“${esc(s.quote ?? s.title ?? '')}”</div>${s.by ? `<div class="s-by">— ${esc(s.by)}</div>` : ''}`
        case 'two-col': return `${head}<div class="s-two"><div>${bl(s.bullets)}</div><div>${bl(s.bullets2)}</div></div>`
        case 'stats': return `${head}<div class="s-stats">${(s.stats ?? []).map((t) => `<div class="s-stat"><div class="s-num">${esc(cellStr(t.num))}</div><div class="s-label">${esc(cellStr(t.label))}</div></div>`).join('')}</div>`
        // chart/embed bodies hold an empty mount; show()/buildPrint init the live content into it.
        case 'chart': return `${head}<div class="s-chart"></div>${s.bullets?.length ? bl(s.bullets) : ''}`
        case 'embed': return `${head}<div class="s-embed"><div class="muted center">（看板内容见浮窗）</div></div>`
        default: return `${head}${bl(s.bullets)}${sub}`
      }
    }
    const slideHtml = (s: SlideSpec) => `<div class="slide slide--${esc(s.layout || 'bullets')}">${body(s)}</div>`
    const curTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
    // Render the live (chart/embed) content of a slide into its mount, in-place.
    const hydrate = (slot: HTMLElement, s: SlideSpec): void => {
      if (s.layout === 'chart' && s.chart) {
        const ce = slot.querySelector('.s-chart') as HTMLElement | null
        if (ce) ui.chart(ce, s.chart)
      } else if (s.layout === 'embed' && (s.spec || s.code)) {
        const ee = slot.querySelector('.s-embed') as HTMLElement | null
        if (ee) {
          try {
            if (s.spec) runSpec(ee, s.spec, tableRows, curTheme())
            else if (!NO_EVAL && s.code) execInto(ee, s.code, tableRows, curTheme(), { 默认: tableRows })
          } catch { ee.textContent = '看板渲染失败' }
        }
      }
    }
    const disposeIn = (node: HTMLElement): void => {
      for (const c of [node, ...Array.from(node.querySelectorAll<HTMLElement>('*'))]) {
        const inst = echarts.getInstanceByDom(c); if (inst) inst.dispose()
      }
    }

    el.innerHTML =
      '<div class="slides-stage" tabindex="0">' +
        '<div class="slide-host"></div>' +
        '<div class="slides-bar">' +
          '<div class="slides-nav"><button class="page slides-prev">‹</button><span class="slides-count"></span></div>' +
          '<div class="slides-dots"></div>' +
          '<div class="slides-nav">' +
            '<button class="page slides-play" title="自动播放">▶</button>' +
            '<button class="page slides-theme" title="切换深色">🌙</button>' +
            '<button class="page slides-next">›</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      // Built on-demand at print time (one slide per page) so 🖨 exports the whole deck.
      '<div class="slides-print"></div>'

    const stage = el.querySelector('.slides-stage') as HTMLElement
    const host = el.querySelector('.slide-host') as HTMLElement
    const countEl = el.querySelector('.slides-count') as HTMLElement
    const dotsEl = el.querySelector('.slides-dots') as HTMLElement
    const playBtn = el.querySelector('.slides-play') as HTMLElement
    const themeBtn = el.querySelector('.slides-theme') as HTMLElement
    dotsEl.innerHTML = data.map((_, i) => `<button class="slides-dot" data-i="${i}"></button>`).join('')
    const dots = Array.from(dotsEl.children) as HTMLElement[]
    let cur = -1
    const show = (i: number): void => {
      const next = Math.max(0, Math.min(n - 1, i))
      if (next === cur) return
      if (cur >= 0) disposeIn(host) // free the leaving slide's chart/embed echarts instances
      cur = next
      host.innerHTML = slideHtml(data[cur])
      countEl.textContent = `${cur + 1} / ${n}`
      dots.forEach((d, j) => d.classList.toggle('active', j === cur))
      hydrate(host, data[cur]) // draw the live chart / embed for the slide now shown
    }

    // ── Auto-play (loops back to the first slide); manual paging restarts the timer ──
    if (slidesTimer) { clearInterval(slidesTimer); slidesTimer = null } // kill a prior deck's timer
    const AUTOPLAY_MS = 5000
    const updPlay = () => { playBtn.textContent = slidesTimer ? '⏸' : '▶'; playBtn.title = slidesTimer ? '暂停' : '自动播放' }
    const stopPlay = () => { if (slidesTimer) { clearInterval(slidesTimer); slidesTimer = null } updPlay() }
    const startPlay = () => { if (slidesTimer) clearInterval(slidesTimer); slidesTimer = setInterval(() => show(cur >= n - 1 ? 0 : cur + 1), AUTOPLAY_MS); updPlay() }
    const bumpPlay = () => { if (slidesTimer) startPlay() } // a manual jump → give the new slide a full interval
    const go = (i: number) => { show(i); bumpPlay() } // user-driven navigation
    playBtn.onclick = () => (slidesTimer ? stopPlay() : startPlay())

    // ── Light / Dark toggle (instant — CSS vars flip on [data-theme]) ──
    const isDark = () => document.documentElement.dataset.theme === 'dark'
    const updTheme = () => { themeBtn.textContent = isDark() ? '☀' : '🌙'; themeBtn.title = isDark() ? '切换浅色' : '切换深色' }
    themeBtn.onclick = () => { document.documentElement.dataset.theme = isDark() ? 'light' : 'dark'; updTheme(); reapplyAccent() }
    updTheme()

    ;(el.querySelector('.slides-prev') as HTMLElement).onclick = () => go(cur - 1)
    ;(el.querySelector('.slides-next') as HTMLElement).onclick = () => go(cur + 1)
    dotsEl.addEventListener('click', (e) => {
      const d = (e.target as HTMLElement).closest('.slides-dot') as HTMLElement | null
      if (d && d.dataset.i != null) go(Number(d.dataset.i))
    })
    stage.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(cur + 1) }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(cur - 1) }
      else if (e.key === 'Home') go(0)
      else if (e.key === 'End') go(n - 1)
    })
    // Click the right/left edge of a slide to page (PPT-style); middle clicks do nothing.
    host.addEventListener('click', (e) => {
      const r = host.getBoundingClientRect()
      const x = (e as MouseEvent).clientX - r.left
      if (x > r.width * 0.62) go(cur + 1)
      else if (x < r.width * 0.38) go(cur - 1)
    })

    // ── PDF export: build a one-slide-per-page stack, init its charts at a real (offscreen) size so
    //    they actually render, print, then tear down. `is-building` keeps it sized-but-hidden on
    //    screen during the build; @media print then reveals it. Embeds show their placeholder. ──
    const printEl = el.querySelector('.slides-print') as HTMLElement
    let built = false
    const buildPrint = () => {
      if (built) return
      built = true
      printEl.classList.add('is-building') // sized (so charts get a real size) but visually hidden
      printEl.innerHTML = data.map(slideHtml).join('')
      const printSlides = Array.from(printEl.children) as HTMLElement[]
      data.forEach((s, i) => { if (s.layout === 'chart' && printSlides[i]) hydrate(printSlides[i], s) })
    }
    const clearPrint = () => {
      if (!built) return
      built = false
      disposeIn(printEl); printEl.innerHTML = ''; printEl.classList.remove('is-building')
    }
    // beforeprint/afterprint cover Ctrl+P; the 🖨 button path builds explicitly (see DATAVIZ_PRINT).
    window.addEventListener('beforeprint', buildPrint)
    window.addEventListener('afterprint', clearPrint)
    if (slidesPrintCleanup) slidesPrintCleanup()
    slidesPrint = { build: buildPrint, clear: clearPrint }
    slidesPrintCleanup = () => {
      window.removeEventListener('beforeprint', buildPrint)
      window.removeEventListener('afterprint', clearPrint)
      clearPrint(); slidesPrint = null
    }

    show(0)
    try { stage.focus() } catch { /* focus is a nice-to-have for key paging */ }
  },
}

// The model may return a bare function BODY, or wrap it in `function render(...) {}` / an
// arrow. If it wraps it, the param list is frequently WRONG (an extra `chart` param, a missing
// comma → SyntaxError, or args that misalign with what we pass). So we UNWRAP any function/arrow
// to its body and run that with OUR fixed param names — the model's signature can't break us.
function execInto(container: HTMLElement, code: string, data: unknown, theme: string, datasets: Record<string, unknown>) {
  let src = code.trim()
  const fnBody = src.match(/^(?:async\s+)?function\s*[\w$]*\s*\([^)]*\)\s*\{([\s\S]*)\}\s*;?\s*$/)
  const arrowBody = src.match(/^(?:async\s+)?\([^)]*\)\s*=>\s*\{([\s\S]*)\}\s*;?\s*$/)
  if (fnBody) src = fnBody[1]
  else if (arrowBody) src = arrowBody[1]
  new Function('data', 'echarts', 'container', 'theme', 'ui', 'datasets', src)(data, echarts, container, theme, ui, datasets)
}
// `execViz` targets the whole page root; `execInto` (hoisted, so ui.slides can call it) lets an
// embed-slide run a saved 看板 in its own slide container. The unwrap keeps a wrong model signature
// from breaking us.
function execViz(code: string, data: unknown, theme: string, datasets: Record<string, unknown>) {
  execInto(root, code, data, theme, datasets)
}

// ── No-remote-code renderer: turn a declarative VizSpec into the same ui.* calls, NO eval ──
type SpecRows = Array<Record<string, string>>

/** Map a declarative DashboardSpec onto ui.dashboard's DashSpec, synthesizing the calc/build
 *  closures from the pure interpreter (the model supplies data, never functions). */
function dashToUi(spec: DashboardSpec, rows: SpecRows): DashSpec {
  return {
    data: rows,
    filters: spec.filters,
    kpis: spec.kpis?.map((k) => ({ label: k.label, calc: (rs: Rows) => formatValue(evalAggregate(rs as SpecRows, k.value), k.value.format) })),
    charts: spec.charts?.map((c) => ({ title: c.title, build: (rs: Rows) => (c.kind === 'rawChart' ? (c as RawChartSpec).option : buildOption(rs as SpecRows, c as VizChartSpec)) })),
    columns: spec.table?.columns,
    pageSize: spec.table?.pageSize,
    actions: spec.table?.actions?.map((a) => ({ label: a.label, build: (row: Record<string, unknown>) => actionTemplate(row as Record<string, string>, a.template) })),
  }
}

/** Render a VizSpec into `container` using the bundled ui.* helpers + interpreter. Hoisted so
 *  ui.slides can call it for embed slides. */
function runSpec(container: HTMLElement, spec: VizSpec, data: unknown, theme: string): void {
  const rows = (Array.isArray(data) ? data : []) as SpecRows
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light'
  container.innerHTML = ''
  if (spec.kind === 'chart' || spec.kind === 'rawChart') {
    const el = document.createElement('div'); el.style.height = '100%'; el.style.minHeight = '320px'
    container.appendChild(el)
    ui.chart(el, spec.kind === 'rawChart' ? spec.option : buildOption(rows, spec))
  } else if (spec.kind === 'table') {
    ui.table(container, rows, {
      columns: spec.columns, pageSize: spec.pageSize, search: spec.search,
      actions: spec.actions?.map((a) => ({ label: a.label, build: (row: Record<string, unknown>) => actionTemplate(row as Record<string, string>, a.template) })),
    })
  } else if (spec.kind === 'dashboard') {
    ui.dashboard(container, dashToUi(spec, rows))
  } else if (spec.kind === 'slides') {
    // data carries the table rows (for embed slides); ui.slides renders the deck reliably.
    ui.slides(container, spec.slides as SlideSpec[], (Array.isArray(data) ? data : []) as Rows)
  } else if (spec.kind === 'site') {
    const wrap = document.createElement('div'); wrap.className = 'site'
    if (spec.title) { const nav = document.createElement('div'); nav.className = 'nav'; nav.innerHTML = `<b>${esc(spec.title)}</b>`; wrap.appendChild(nav) }
    for (const s of spec.sections) {
      const tag = s.type === 'hero' ? '1' : '2'
      const sec = document.createElement('section')
      sec.className = s.type === 'hero' ? 'hero' : 'section'
      sec.innerHTML =
        (s.title ? `<h${tag}>${esc(s.title)}</h${tag}>` : '') +
        (s.subtitle ? `<p class="sub">${esc(s.subtitle)}</p>` : '') +
        (s.body ? `<p>${esc(s.body)}</p>` : '')
      wrap.appendChild(sec)
    }
    const mount = document.createElement('div'); mount.className = 'section'
    wrap.appendChild(mount)
    container.appendChild(wrap)
    ui.dashboard(mount, dashToUi(spec.dashboard, rows))
  }
}

function render(msg: RenderMsg) {
  errEl.style.display = 'none'
  root.style.display = 'block'
  // Activate the design-system light/dark tokens for the whole page.
  document.documentElement.dataset.theme = msg.theme === 'dark' ? 'dark' : 'light'
  document.documentElement.dataset.b = '7d2e84'
  // Write-back is enabled only when the host passed a single-table Base source. Reset drafts
  // on every (re-)render so a regenerate/refine starts clean.
  editEnabled = !!msg.source
  fieldTypes = msg.fieldTypes ?? {}
  lastNonce = msg.nonce
  drafts.clear()
  if (slidesTimer) { clearInterval(slidesTimer); slidesTimer = null } // stop a prior deck's auto-play
  if (slidesPrintCleanup) { slidesPrintCleanup(); slidesPrintCleanup = null } // drop a prior deck's print hooks
  try {
    eachChart((c) => c.dispose())
    root.innerHTML = ''
    // Contract: `code` builds the chart(s). The model INITS its own instance(s) — single:
    // echarts.init(container).setOption(...); dashboard: a CSS grid of child divs each
    // echarts.init'd. We just dispose/resize them (execViz tolerates body OR full function).
    // `datasets` defaults to a single-entry map so multi-table code paths still work when the
    // doc has just one sub-table (and `data` always = the primary table's rows).
    if (msg.spec) {
      runSpec(root, msg.spec, msg.data, msg.theme === 'dark' ? 'dark' : 'light')
    } else if (!NO_EVAL && typeof msg.code === 'string') {
      const datasets = msg.datasets && Object.keys(msg.datasets).length ? msg.datasets : { 默认: msg.data }
      execViz(msg.code, msg.data, msg.theme === 'dark' ? 'dark' : 'light', datasets)
    } else {
      throw new Error(NO_EVAL
        ? '此看板由旧版生成，请在「我的看板」里点「重新生成」用当前数据重建（本版本不执行生成代码）。'
        : '无可渲染内容（缺少 code/spec）。')
    }
    eachChart((c) => c.resize())
    reapplyAccent() // keep the user's chosen color across regenerate/refine (CSS vars + chart palette)
    notifyDirty() // sync the overlay's 提交 button to 0 pending after a fresh render
    window.parent.postMessage({ type: 'RENDER_OK', nonce: msg.nonce }, '*')
  } catch (e) {
    const m = e instanceof Error ? (e.stack || e.message) : String(e)
    showError(m)
    window.parent.postMessage({ type: 'RENDER_ERR', nonce: msg.nonce, message: e instanceof Error ? e.message : String(e) }, '*')
  }
}

window.addEventListener('message', (event) => {
  // Only accept from our embedder (the content script's window). Cross-frame nonce gating
  // happens on the content-script side; here we just refuse non-parent senders.
  if (event.source !== window.parent) return
  // Print/export-PDF: needs `allow-modals` on BOTH the <iframe sandbox> AND the manifest's
  // content_security_policy.sandbox directive (they intersect — drop it in either and print()
  // is silently ignored). With both, window.print() prints THIS sandbox doc. For a slide
  // deck, build the full one-slide-per-page stack SYNCHRONOUSLY first (don't depend on beforeprint
  // firing), print (blocks until the dialog closes), then tear it down.
  if ((event.data as { type?: string })?.type === 'DATAVIZ_PRINT') {
    if (slidesPrint) {
      slidesPrint.build()
      eachChart((c) => c.resize())
      window.print()
      slidesPrint.clear()
    } else {
      eachChart((c) => c.resize()); window.print()
    }
    return
  }
  // Accent color picked on the overlay chrome → re-theme design-system vars + chart palette live.
  if ((event.data as { type?: string })?.type === 'DATAVIZ_ACCENT') {
    applyAccent((event.data as { color?: string | null }).color ?? null); return
  }
  // Write-back finished on the host → drafts are persisted; clear them (optimistic values stay).
  if ((event.data as { type?: string })?.type === 'DATAVIZ_WRITE_DONE') {
    // Bind the clear to THIS render: a stale/late write-done (from a prior deck/render, different
    // nonce) must not wipe edits the user has since staged. notifyDirty re-syncs the 提交 button.
    if ((event.data as { nonce?: string }).nonce === lastNonce) { drafts.clear(); notifyDirty() }
    return
  }
  const msg = event.data as RenderMsg
  if (msg?.type === 'DATAVIZ_RENDER' && (typeof msg.code === 'string' || (msg.spec != null && typeof msg.spec === 'object'))) { render(msg); return }
})

// Keep all charts fitted to the (resizable) overlay. rAF-coalesced: a resize-drag fires this
// every frame, and the callback walks the whole DOM (eachChart) + re-renders every canvas —
// doing that synchronously per frame stutters on large sites. One resize per animation frame.
let resizeRaf = 0
const ro = new ResizeObserver(() => {
  if (resizeRaf) return
  resizeRaf = requestAnimationFrame(() => { resizeRaf = 0; eachChart((c) => c.resize()) })
})
ro.observe(root)

// Tell the embedder we're ready to receive a render (handles the iframe-load race).
window.parent.postMessage({ type: 'DATAVIZ_READY' }, '*')
