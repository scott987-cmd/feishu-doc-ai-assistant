import type { ClipCapture } from './types'

/**
 * Captures the active tab's content for the Web Clipper.
 *
 * IMPORTANT: this function is injected into the PAGE world via
 * `chrome.scripting.executeScript({ func: captureClip, args: [maxChars] })`. Chrome
 * serializes it with `Function.prototype.toString`, so it MUST be fully self-contained —
 * no imports, no references to module-scope identifiers, no closures over outer state.
 * All inputs come through parameters; all helpers are nested inside the body. (The
 * `ClipCapture` type annotation is erased at runtime, so it doesn't leak into the
 * serialized source.)
 *
 * Privacy: it reads visible text only. `element.innerText` does NOT include `<input>` /
 * `<textarea>` values, so typed secrets (passwords, card numbers) are never captured; we
 * also strip form fields and page chrome defensively. The result is previewed to the user
 * before anything is sent anywhere.
 */
export function captureClip(maxChars: number): ClipCapture {
  const cap = (s: string): { text: string; truncated: boolean } => {
    const t = (s || '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    return t.length > maxChars
      ? { text: t.slice(0, maxChars), truncated: true }
      : { text: t, truncated: false }
  }

  // innerText (layout-aware, drops hidden text) in real browsers; textContent as a
  // fallback (e.g. jsdom in tests, which doesn't implement innerText).
  const readText = (el: HTMLElement): string => el.innerText || el.textContent || ''
  const cellText = (el: Element): string =>
    ((el as HTMLElement).innerText || el.textContent || '').trim().replace(/\s+/g, ' ').replace(/\|/g, '/')

  // ── Structured-table extraction (multi-strategy) ───────────────────────────
  // Many data grids (stock screeners etc.) are NOT <table> — they're ARIA grids, ag-Grid,
  // or plain <div> grids. We try several strategies, collect 2-D candidates, and keep the
  // dominant one (rows × cols), so the AI gets real rows/columns instead of one run-on line.
  const candidates: string[][][] = []
  const rowScore = (rows: string[][]) =>
    rows.length >= 2 ? rows.length * Math.max(...rows.map((r) => r.length)) : 0

  // 1) Native <table>
  document.querySelectorAll('table').forEach((t) => {
    const rows: string[][] = []
    t.querySelectorAll('tr').forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll('th, td'), cellText)
      if (cells.some(Boolean)) rows.push(cells)
    })
    if (rows.length >= 2) candidates.push(rows)
  })

  // 2) ARIA grid (role=table/grid → role=row → role=*cell)
  document.querySelectorAll('[role="table"], [role="grid"]').forEach((g) => {
    const rows: string[][] = []
    g.querySelectorAll('[role="row"]').forEach((r) => {
      const cells = Array.from(
        r.querySelectorAll('[role="cell"], [role="gridcell"], [role="columnheader"], [role="rowheader"]'),
        cellText,
      )
      if (cells.some(Boolean)) rows.push(cells)
    })
    if (rows.length >= 2) candidates.push(rows)
  })

  // 3) ag-Grid — header lives in a separate container; align cells by their col-id (also
  //    survives column pinning/reordering). NOTE: ag-Grid virtualizes, so only the rows
  //    currently scrolled into view are in the DOM.
  const agRows = document.querySelectorAll('.ag-row')
  if (agRows.length) {
    const headerCells = Array.from(document.querySelectorAll('.ag-header-cell[col-id]'))
    const order = headerCells.map((h) => h.getAttribute('col-id') as string).filter(Boolean)
    const headerText: Record<string, string> = {}
    headerCells.forEach((h) => { headerText[h.getAttribute('col-id') as string] = cellText(h) })
    const rows: string[][] = []
    if (order.length) rows.push(order.map((id) => headerText[id] || ''))
    agRows.forEach((r) => {
      const map: Record<string, string> = {}
      r.querySelectorAll('.ag-cell[col-id]').forEach((c) => { map[c.getAttribute('col-id') as string] = cellText(c) })
      const ids = order.length ? order : Object.keys(map)
      const cells = ids.map((id) => map[id] || '')
      if (cells.some(Boolean)) rows.push(cells)
    })
    if (rows.length >= 2) candidates.push(rows)
  }

  // 4) Generic repeated-row detection — a <div>/<ul> whose children share the same cell
  //    count (a grid without semantic markup). Pick the container with the most data.
  if (!candidates.length) {
    let best: { el: Element; cols: number } | null = null
    let bestN = 0
    let scanned = 0
    const conts = document.querySelectorAll('ul, ol, tbody, [role="rowgroup"], div')
    for (const cont of Array.from(conts)) {
      if (++scanned > 5000) break
      const kids = Array.from(cont.children)
      if (kids.length < 5) continue
      const freq: Record<number, number> = {}
      for (const k of kids) { const n = k.children.length; if (n >= 2) freq[n] = (freq[n] || 0) + 1 }
      let mode = 0, modeF = 0
      for (const n in freq) if (freq[n] > modeF) { modeF = freq[n]; mode = +n }
      if (mode >= 2 && modeF >= 3 && modeF * mode > bestN) { bestN = modeF * mode; best = { el: cont, cols: mode } }
    }
    if (best) {
      const rows: string[][] = []
      for (const k of Array.from(best.el.children)) {
        if (k.children.length !== best.cols) continue
        const cells = Array.from(k.children, cellText)
        if (cells.some(Boolean)) rows.push(cells)
      }
      if (rows.length >= 2) candidates.push(rows)
    }
  }

  // Drop columns that are empty in every DATA row (checkbox/spacer columns like a
  // "select" tick) so they don't become junk fields in the target table.
  const dropEmptyCols = (rows: string[][]): string[][] => {
    const cols = Math.max(...rows.map((r) => r.length))
    const keep: number[] = []
    for (let c = 0; c < cols; c++) {
      if (rows.slice(1).some((r) => (r[c] ?? '').trim() !== '')) keep.push(c)
    }
    return rows.map((r) => keep.map((c) => r[c] ?? ''))
  }
  const toMd = (rowsIn: string[][]): string => {
    const rows = dropEmptyCols(rowsIn)
    const cols = Math.max(0, ...rows.map((r) => r.length))
    if (cols < 2) return ''
    const line = (r: string[]) => '| ' + Array.from({ length: cols }, (_, i) => r[i] ?? '').join(' | ') + ' |'
    return [line(rows[0]), '|' + ' --- |'.repeat(cols), ...rows.slice(1).map(line)].join('\n')
  }
  let bestRows: string[][] | null = null
  let bestScore = 0
  for (const rows of candidates) { const s = rowScore(rows); if (s > bestScore) { bestScore = s; bestRows = rows } }
  const markdownTables = bestRows ? [toMd(bestRows)].filter(Boolean) : []

  const selection = (window.getSelection && window.getSelection()?.toString().trim()) || ''

  // Pick the most "article-like" container; fall back to <body>.
  const pickMain = (): HTMLElement => {
    const candidates = ['article', 'main', '[role="main"]', '#content', '.content', '#main', '.article']
    for (const q of candidates) {
      const el = document.querySelector(q) as HTMLElement | null
      if (el && readText(el).trim().length > 200) return el
    }
    return document.body
  }

  const root = pickMain()
  // Clone so we never mutate the live page; strip scripts, chrome, and form fields.
  const clone = root.cloneNode(true) as HTMLElement
  clone
    .querySelectorAll('script, style, noscript, nav, header, footer, aside, svg, input, textarea, select')
    .forEach((n) => n.remove())

  // Prefer structured tables when the page has them (e.g. a stock screener / data grid) —
  // that's almost always what the user wants to clip. Otherwise use the readable text.
  const content = cap(markdownTables.length ? markdownTables.join('\n\n') : readText(clone))
  const sel = cap(selection)

  return {
    url: location.href,
    title: document.title,
    selectedText: sel.text,
    content: content.text,
    capturedAt: Date.now(),
    truncated: content.truncated || sel.truncated,
  }
}

/**
 * Accumulate table rows across scroll steps with header-once + dedup-by-cell-content.
 * Exported ONLY for unit testing — `captureClipScrolling` below duplicates this inline
 * (it can't import anything, see the serialization note). Keep the two behaviours identical.
 * Returns how many NEW data rows were added.
 */
export function mergeTableRows(
  acc: { header: string[] | null; out: string[][]; seen: Set<string> },
  rows: string[][] | null,
): number {
  if (!rows || !rows.length) return 0
  const key = (r: string[]) => r.join('')
  let added = 0
  let start = 0
  if (!acc.header) { acc.header = rows[0]; acc.out.push(rows[0]); acc.seen.add(key(rows[0])); start = 1 }
  for (let i = start; i < rows.length; i++) {
    const r = rows[i]
    if (acc.header && key(r) === key(acc.header)) continue // repeated (sticky) header
    const k = key(r)
    if (!acc.seen.has(k)) { acc.seen.add(k); acc.out.push(r); added++ }
  }
  return added
}

/**
 * Full-table capture for VIRTUALIZED grids (ag-Grid etc.) that only keep the visible rows
 * in the DOM: auto-scroll the grid/page, accumulate unique rows as they render, until no
 * new rows appear (or a hard cap). Self-contained & async — injected via executeScript and
 * serialized, so it must NOT reference any module-scope identifier (mergeTableRows is
 * re-implemented inline here on purpose). Restores the original scroll position when done.
 */
export async function captureClipScrolling(
  maxChars: number,
  maxSteps: number,
  stepDelayMs: number,
): Promise<ClipCapture> {
  const cellText = (el: Element): string =>
    ((el as HTMLElement).innerText || el.textContent || '').trim().replace(/\s+/g, ' ').replace(/\|/g, '/')
  const readText = (el: HTMLElement): string => el.innerText || el.textContent || ''
  const rowScore = (rows: string[][]) => (rows.length >= 2 ? rows.length * Math.max(...rows.map((r) => r.length)) : 0)

  // Best 2-D table on the page right now (same multi-strategy as captureClip), RAW rows.
  const extractBestRows = (): string[][] | null => {
    const candidates: string[][][] = []
    document.querySelectorAll('table').forEach((t) => {
      const rows: string[][] = []
      t.querySelectorAll('tr').forEach((tr) => {
        const cells = Array.from(tr.querySelectorAll('th, td'), cellText)
        if (cells.some(Boolean)) rows.push(cells)
      })
      if (rows.length >= 2) candidates.push(rows)
    })
    document.querySelectorAll('[role="table"], [role="grid"]').forEach((g) => {
      const rows: string[][] = []
      g.querySelectorAll('[role="row"]').forEach((r) => {
        const cells = Array.from(
          r.querySelectorAll('[role="cell"], [role="gridcell"], [role="columnheader"], [role="rowheader"]'),
          cellText,
        )
        if (cells.some(Boolean)) rows.push(cells)
      })
      if (rows.length >= 2) candidates.push(rows)
    })
    const agRows = document.querySelectorAll('.ag-row')
    if (agRows.length) {
      const headerCells = Array.from(document.querySelectorAll('.ag-header-cell[col-id]'))
      const order = headerCells.map((h) => h.getAttribute('col-id') as string).filter(Boolean)
      const headerText: Record<string, string> = {}
      headerCells.forEach((h) => { headerText[h.getAttribute('col-id') as string] = cellText(h) })
      const rows: string[][] = []
      if (order.length) rows.push(order.map((id) => headerText[id] || ''))
      agRows.forEach((r) => {
        const map: Record<string, string> = {}
        r.querySelectorAll('.ag-cell[col-id]').forEach((c) => { map[c.getAttribute('col-id') as string] = cellText(c) })
        const ids = order.length ? order : Object.keys(map)
        const cells = ids.map((id) => map[id] || '')
        if (cells.some(Boolean)) rows.push(cells)
      })
      if (rows.length >= 2) candidates.push(rows)
    }
    if (!candidates.length) {
      let best: { el: Element; cols: number } | null = null
      let bestN = 0, scanned = 0
      for (const cont of Array.from(document.querySelectorAll('ul, ol, tbody, [role="rowgroup"], div'))) {
        if (++scanned > 5000) break
        const kids = Array.from(cont.children)
        if (kids.length < 5) continue
        const freq: Record<number, number> = {}
        for (const k of kids) { const n = k.children.length; if (n >= 2) freq[n] = (freq[n] || 0) + 1 }
        let mode = 0, modeF = 0
        for (const n in freq) if (freq[n] > modeF) { modeF = freq[n]; mode = +n }
        if (mode >= 2 && modeF >= 3 && modeF * mode > bestN) { bestN = modeF * mode; best = { el: cont, cols: mode } }
      }
      if (best) {
        const rows: string[][] = []
        for (const k of Array.from(best.el.children)) {
          if (k.children.length !== best.cols) continue
          const cells = Array.from(k.children, cellText)
          if (cells.some(Boolean)) rows.push(cells)
        }
        if (rows.length >= 2) candidates.push(rows)
      }
    }
    let bestRows: string[][] | null = null
    let bestScore = 0
    for (const rows of candidates) { const s = rowScore(rows); if (s > bestScore) { bestScore = s; bestRows = rows } }
    return bestRows
  }

  // Drop columns empty in every data row, then render Markdown (matches captureClip).
  const toMd = (rowsIn: string[][]): string => {
    const cols0 = Math.max(0, ...rowsIn.map((r) => r.length))
    const keep: number[] = []
    for (let c = 0; c < cols0; c++) if (rowsIn.slice(1).some((r) => (r[c] ?? '').trim() !== '')) keep.push(c)
    const rows = rowsIn.map((r) => keep.map((c) => r[c] ?? ''))
    const cols = Math.max(0, ...rows.map((r) => r.length))
    if (cols < 2) return ''
    const line = (r: string[]) => '| ' + Array.from({ length: cols }, (_, i) => r[i] ?? '').join(' | ') + ' |'
    return [line(rows[0]), '|' + ' --- |'.repeat(cols), ...rows.slice(1).map(line)].join('\n')
  }
  const cap = (s: string): { text: string; truncated: boolean } => {
    const t = (s || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    return t.length > maxChars ? { text: t.slice(0, maxChars), truncated: true } : { text: t, truncated: false }
  }

  // Scroll container: ag-Grid viewport → scrollable ancestor of the table → page root.
  const findScroller = (): Element => {
    const ag = document.querySelector('.ag-body-viewport')
    if (ag && ag.scrollHeight > ag.clientHeight + 40) return ag
    let node = document.querySelector('.ag-row, table, [role="grid"], [role="table"]')?.parentElement || null
    while (node && node !== document.body) {
      const ov = getComputedStyle(node).overflowY
      if (node.scrollHeight > node.clientHeight + 40 && /(auto|scroll|overlay)/.test(ov)) return node
      node = node.parentElement
    }
    return document.scrollingElement || document.documentElement
  }

  // ── accumulate (inline twin of mergeTableRows) ──
  const acc: { header: string[] | null; out: string[][]; seen: Set<string> } = { header: null, out: [], seen: new Set() }
  const key = (r: string[]) => r.join('')
  const merge = (rows: string[][] | null): number => {
    if (!rows || !rows.length) return 0
    let added = 0
    let start = 0
    if (!acc.header) { acc.header = rows[0]; acc.out.push(rows[0]); acc.seen.add(key(rows[0])); start = 1 }
    for (let i = start; i < rows.length; i++) {
      const r = rows[i]
      if (acc.header && key(r) === key(acc.header)) continue
      const k = key(r)
      if (!acc.seen.has(k)) { acc.seen.add(k); acc.out.push(r); added++ }
    }
    return added
  }

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
  const scroller = findScroller()
  const startTop = scroller.scrollTop
  const MAX_ROWS = 5000
  try {
    let stale = 0
    for (let step = 0; step < maxSteps; step++) {
      merge(extractBestRows())
      const before = scroller.scrollTop
      scroller.scrollTop = Math.min(scroller.scrollHeight, before + Math.max(100, scroller.clientHeight * 0.9))
      await sleep(stepDelayMs)
      const added = merge(extractBestRows())
      const atBottom = scroller.scrollTop <= before + 2
      stale = added === 0 ? stale + 1 : 0
      if (stale >= 3) break
      if (atBottom && added === 0) break
      if (acc.out.length >= MAX_ROWS) break
      if (toMd(acc.out).length >= maxChars) break
    }
  } finally {
    try { scroller.scrollTop = startTop } catch { /* best-effort restore */ }
  }

  // ≥2 rows → a real table; else fall back to readable text so non-grid pages still work.
  const out = acc.out.length >= 2 ? cap(toMd(acc.out)) : cap(readText(document.body))
  return {
    url: location.href,
    title: document.title,
    selectedText: '',
    content: out.text,
    capturedAt: Date.now(),
    truncated: out.truncated,
  }
}
