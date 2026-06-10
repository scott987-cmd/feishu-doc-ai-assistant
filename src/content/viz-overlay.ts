/**
 * Data-viz overlays: one or more draggable/resizable floating windows on the Feishu page,
 * keyed by vizId, each hosting an isolated sandbox iframe that renders the AI-generated
 * ECharts code. Multiple saved dashboards can be open at once (each its own window). This
 * module only ferries {code, data} in and {ok/err} out; the generated code is sandboxed.
 */

import { parseFeishuContext } from '../shared/feishu/pageUrl'
import { vizMatchesCtx } from '../shared/dataviz/scope'
import { ACCENT_PRESETS } from '../shared/theme'

interface VizBaseSource { kind: 'base'; appToken: string; tableId: string }
interface Payload { vizId: string; code?: string; spec?: unknown; data: unknown[]; datasets?: Record<string, unknown[]>; theme?: 'light' | 'dark'; name?: string; source?: VizBaseSource; fieldTypes?: Record<string, string> }
// Field values are type-coerced in the sandbox (Number→number, Checkbox→boolean, Date→ms) before
// they reach here, so the cached edits carry mixed JSON types — batch_update wants exactly that.
type Edit = { record_id: string; fields: Record<string, unknown> }
export interface WriteResult { ok?: boolean; done?: number; failed?: string; remaining?: number; note?: string; rowAction?: boolean }

interface Overlay {
  el: HTMLDivElement
  iframe: HTMLIFrameElement
  titleEl: HTMLSpanElement
  submitBtn: HTMLButtonElement
  nonce: string
  ready: boolean
  pending: Payload | null
  /** Set for a single-table Base site → write-back target for the 提交 button. */
  source?: VizBaseSource
  /** Latest pending edits the sandbox staged (cached so the 提交 button can send them). */
  pendingEdits?: Edit[]
  /** Watchdog: re-enables 提交 if no write-back result returns (e.g. SW terminated mid-batch). */
  submitTimer?: ReturnType<typeof setTimeout>
}

const overlays = new Map<string, Overlay>()
let listening = false
let zTop = 2147483600

function newNonce(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function destroy(id: string) {
  const o = overlays.get(id)
  if (o) { o.el.remove(); overlays.delete(id) }
}

function ensure(id: string): Overlay {
  const existing = overlays.get(id)
  if (existing) return existing

  const idx = overlays.size
  const el = document.createElement('div')
  el.style.cssText =
    `position:fixed;right:${24 + idx * 26}px;top:${64 + idx * 26}px;width:min(900px,92vw);height:min(620px,82vh);` +
    'min-width:320px;min-height:220px;z-index:' + (++zTop) + ';background:#fff;border:1px solid #e3e6ef;' +
    'border-radius:12px;box-shadow:0 10px 44px rgba(20,23,40,.20);display:flex;flex-direction:column;overflow:hidden;'

  const bar = document.createElement('div')
  bar.style.cssText =
    'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;' +
    'background:#f5f6fb;border-bottom:1px solid #e3e6ef;cursor:move;user-select:none;' +
    "font:13px/1.4 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;flex-shrink:0;"
  const titleEl = document.createElement('span')
  titleEl.textContent = '📊 数据可视化'
  titleEl.style.cssText = 'font-weight:600;color:#222;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
  // Title-bar actions live on the page (the sandbox can't draw chrome). 🖨 asks the iframe to
  // print itself → the user's print dialog → "Save as PDF" captures the full page incl. charts.
  const actions = document.createElement('div')
  actions.style.cssText = 'display:flex;align-items:center;gap:6px;flex-shrink:0;'
  const iconBtn = (txt: string, title: string) => {
    const b = document.createElement('button')
    b.textContent = txt; b.title = title
    b.style.cssText = 'border:none;background:transparent;cursor:pointer;font-size:14px;color:#888;flex-shrink:0;line-height:1;'
    return b
  }
  // 提交 button: hidden until the sandbox reports staged edits. Click → confirm ONCE → ask the
  // background to batch-write as the user. Nothing is written without this explicit click.
  const submit = document.createElement('button')
  submit.style.cssText = 'display:none;border:none;border-radius:6px;background:#3a55ee;color:#fff;cursor:pointer;font-size:12px;font-weight:600;padding:4px 10px;flex-shrink:0;'
  submit.onclick = () => {
    const ov = overlays.get(id)
    if (!ov?.source || !ov.pendingEdits?.length) return
    // After Feishu SPA navigation this overlay floats on with its baked-in write-back target. If
    // the current page is NO LONGER that data-table, force an explicit ack so staged edits aren't
    // silently written back to the previous table the user thinks they've left.
    const onSource = vizMatchesCtx(ov.source, parseFeishuContext(location.href))
    const ask = onSource
      ? `将更新 ${ov.pendingEdits.length} 行到飞书多维表格，确认提交？`
      : `⚠ 当前页面已不是这份数据的来源数据表。\n仍要把 ${ov.pendingEdits.length} 行修改写回到原来的数据表吗？`
    if (!confirm(ask)) return
    submit.disabled = true; submit.textContent = '提交中…'
    // Watchdog: the result message re-enables the button; if the SW is terminated mid-batch it
    // never arrives, so recover to a warn state after a generous timeout (a late result still
    // corrects via writeResult). Long enough not to fire during a legitimate large batch.
    if (ov.submitTimer) clearTimeout(ov.submitTimer)
    ov.submitTimer = setTimeout(() => {
      submit.disabled = false
      submit.textContent = '⚠ 可能已提交，请刷新核对'
    }, 60_000)
    try { chrome.runtime.sendMessage({ type: 'DATAVIZ_WRITE_BACK', vizId: id, source: ov.source, edits: ov.pendingEdits }) }
    catch { if (ov.submitTimer) clearTimeout(ov.submitTimer); submit.disabled = false; submit.textContent = `⬆ 提交 ${ov.pendingEdits.length} 项修改` }
  }
  // 🎨 配色调整：a popover with the 7 brand presets + a custom color picker + reset. Picking a
  // color re-themes the rendered PPT / 网站 / 看板 / 图表 live (design-system vars + chart palette).
  const sendAccent = (color: string | null) => overlays.get(id)?.iframe.contentWindow?.postMessage({ type: 'DATAVIZ_ACCENT', color }, '*')
  const pop = document.createElement('div')
  pop.style.cssText = 'display:none;position:absolute;top:44px;right:8px;z-index:' + (zTop + 1) + ';background:#fff;border:1px solid #e3e6ef;border-radius:10px;box-shadow:0 8px 24px rgba(20,23,40,.18);padding:10px;width:196px;cursor:default;'
  const sw = document.createElement('div'); sw.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;'
  const custom = document.createElement('input'); custom.type = 'color'; custom.value = '#4f6bff'; custom.title = '自定义颜色'
  custom.style.cssText = 'width:32px;height:24px;border:1px solid #d9dcea;border-radius:6px;background:transparent;cursor:pointer;padding:0;'
  for (const preset of ACCENT_PRESETS) {
    const dot = document.createElement('button'); dot.title = preset.name
    dot.style.cssText = `width:22px;height:22px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px #d9dcea;cursor:pointer;padding:0;background:${preset.hex};`
    dot.onclick = () => { custom.value = preset.hex; sendAccent(preset.hex); pop.style.display = 'none' }
    sw.append(dot)
  }
  custom.oninput = () => sendAccent(custom.value)
  const reset = document.createElement('button'); reset.textContent = '恢复默认'
  reset.style.cssText = 'border:none;background:#eef1ff;color:#3a55ee;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;padding:6px 10px;'
  reset.onclick = () => { custom.value = '#4f6bff'; sendAccent(null); pop.style.display = 'none' }
  const foot = document.createElement('div'); foot.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;'
  foot.append(custom, reset); pop.append(sw, foot)
  const accent = iconBtn('🎨', '调整配色')
  accent.onclick = (e) => { e.stopPropagation(); pop.style.display = pop.style.display === 'none' ? 'block' : 'none' }
  // Close on any pointer-down outside the popover; self-removes once this overlay is gone.
  const onDocDown = (e: MouseEvent) => {
    if (!document.body.contains(el)) { document.removeEventListener('mousedown', onDocDown); return }
    if (pop.style.display === 'block' && !pop.contains(e.target as Node) && e.target !== accent) pop.style.display = 'none'
  }
  document.addEventListener('mousedown', onDocDown)
  const print = iconBtn('🖨', '打印 / 导出 PDF（含图表整页）')
  print.onclick = () => overlays.get(id)?.iframe.contentWindow?.postMessage({ type: 'DATAVIZ_PRINT' }, '*')
  const close = iconBtn('✕', '关闭')
  close.onclick = () => destroy(id)
  actions.append(submit, accent, print, close)
  bar.append(titleEl, actions)

  const iframe = document.createElement('iframe')
  iframe.src = chrome.runtime.getURL('src/sandbox/index.html')
  // allow-scripts: run the generated app. allow-modals: let the "可打印报表" kind call
  // window.print() (sandboxed iframes silently ignore print()/alert() without it).
  // Deliberately NO allow-same-origin — the null/opaque origin is what keeps the LLM code
  // walled off from chrome.*/token/storage; granting an origin would defeat the isolation.
  iframe.setAttribute('sandbox', 'allow-scripts allow-modals')
  iframe.style.cssText = 'flex:1;border:none;width:100%;background:#fff;'

  el.append(bar, iframe, pop)
  document.body.appendChild(el)
  makeDraggable(el, bar)
  makeResizable(el)

  const o: Overlay = { el, iframe, titleEl, submitBtn: submit, nonce: newNonce(), ready: false, pending: null }
  overlays.set(id, o)
  return o
}

/** Brief auto-dismissing toast inside an overlay (write-back / row-action feedback). */
function flash(o: Overlay, text: string) {
  const t = document.createElement('div')
  t.textContent = text
  t.style.cssText = 'position:absolute;left:50%;bottom:14px;transform:translateX(-50%);z-index:10;max-width:80%;'
    + 'background:rgba(20,23,40,.92);color:#fff;padding:7px 14px;border-radius:8px;'
    + "font:12px/1.4 -apple-system,'PingFang SC',sans-serif;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.25);"
  o.el.appendChild(t)
  setTimeout(() => t.remove(), 2800)
}

function makeDraggable(el: HTMLElement, handle: HTMLElement) {
  let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false
  const front = () => { el.style.zIndex = String(++zTop) }
  handle.addEventListener('pointerdown', (e) => {
    front()
    if ((e.target as HTMLElement).tagName === 'BUTTON') return
    dragging = true
    const r = el.getBoundingClientRect()
    el.style.left = r.left + 'px'; el.style.top = r.top + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto'
    sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top
    handle.setPointerCapture(e.pointerId)
  })
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return
    el.style.left = Math.max(0, ox + e.clientX - sx) + 'px'
    el.style.top = Math.max(0, oy + e.clientY - sy) + 'px'
  })
  handle.addEventListener('pointerup', (e) => { dragging = false; try { handle.releasePointerCapture(e.pointerId) } catch { /* */ } })
}

// Resize from all 4 corners + 4 edges (CSS `resize` only gives the SE corner). Handles sit
// just inside the edges (the overlay clips overflow), above the iframe so they get the events.
function makeResizable(el: HTMLElement) {
  const MIN_W = 320, MIN_H = 200
  const spec: Array<{ css: string; l: boolean; r: boolean; t: boolean; b: boolean }> = [
    { l: true, r: false, t: true, b: false, css: 'top:0;left:0;width:14px;height:14px;cursor:nwse-resize' },
    { l: false, r: true, t: true, b: false, css: 'top:0;right:0;width:14px;height:14px;cursor:nesw-resize' },
    { l: true, r: false, t: false, b: true, css: 'bottom:0;left:0;width:14px;height:14px;cursor:nesw-resize' },
    { l: false, r: true, t: false, b: true, css: 'bottom:0;right:0;width:14px;height:14px;cursor:nwse-resize' },
    { l: false, r: false, t: true, b: false, css: 'top:0;left:14px;right:14px;height:6px;cursor:ns-resize' },
    { l: false, r: false, t: false, b: true, css: 'bottom:0;left:14px;right:14px;height:6px;cursor:ns-resize' },
    { l: true, r: false, t: false, b: false, css: 'left:0;top:14px;bottom:14px;width:6px;cursor:ew-resize' },
    { l: false, r: true, t: false, b: false, css: 'right:0;top:14px;bottom:14px;width:6px;cursor:ew-resize' },
  ]
  for (const h of spec) {
    const grip = document.createElement('div')
    grip.style.cssText = 'position:absolute;z-index:6;' + h.css
    el.appendChild(grip)
    let sx = 0, sy = 0, sl = 0, st = 0, sw = 0, sh = 0, active = false
    grip.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault(); active = true
      el.style.zIndex = String(++zTop)
      const r = el.getBoundingClientRect()
      el.style.left = r.left + 'px'; el.style.top = r.top + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto'
      sx = e.clientX; sy = e.clientY; sl = r.left; st = r.top; sw = r.width; sh = r.height
      grip.setPointerCapture(e.pointerId)
    })
    grip.addEventListener('pointermove', (e) => {
      if (!active) return
      const dx = e.clientX - sx, dy = e.clientY - sy
      let w = sw, ht = sh, left = sl, top = st
      if (h.r) w = Math.max(MIN_W, sw + dx)
      if (h.l) { w = Math.max(MIN_W, sw - dx); left = sl + (sw - w) }
      if (h.b) ht = Math.max(MIN_H, sh + dy)
      if (h.t) { ht = Math.max(MIN_H, sh - dy); top = st + (sh - ht) }
      el.style.width = w + 'px'; el.style.height = ht + 'px'; el.style.left = left + 'px'; el.style.top = top + 'px'
    })
    grip.addEventListener('pointerup', (e) => { active = false; try { grip.releasePointerCapture(e.pointerId) } catch { /* */ } })
  }
}

function post(o: Overlay, p: Payload) {
  o.iframe.contentWindow?.postMessage(
    { type: 'DATAVIZ_RENDER', nonce: o.nonce, code: p.code, spec: p.spec, data: p.data, datasets: p.datasets, theme: p.theme, source: p.source, fieldTypes: p.fieldTypes },
    '*',
  )
}

function onWindowMessage(e: MessageEvent) {
  let target: Overlay | undefined
  for (const [, o] of overlays) if (e.source === o.iframe.contentWindow) { target = o; break }
  if (!target) return
  const d = e.data as { type?: string; nonce?: string; message?: string }
  if (d?.type === 'DATAVIZ_READY') {
    target.ready = true
    if (target.pending) { post(target, target.pending); target.pending = null }
    return
  }
  if (d?.nonce !== target.nonce) return // every cross-frame message must echo this overlay's nonce
  if (d.type === 'RENDER_OK') {
    try { chrome.runtime.sendMessage({ type: 'DATAVIZ_RESULT', ok: true }) } catch { /* */ }
  } else if (d.type === 'RENDER_ERR') {
    try { chrome.runtime.sendMessage({ type: 'DATAVIZ_RESULT', ok: false, message: d.message }) } catch { /* */ }
  } else if (d.type === 'DATAVIZ_DIRTY') {
    // Sandbox staged/cleared edits → reflect the count on the 提交 button.
    target.pendingEdits = ((d as { edits?: Edit[] }).edits) ?? []
    const n = target.pendingEdits.length
    const btn = target.submitBtn
    if (n > 0) { btn.style.display = ''; btn.disabled = false; btn.textContent = `⬆ 提交 ${n} 项修改` }
    else { btn.style.display = 'none' }
  } else if (d.type === 'DATAVIZ_ROW_ACTION') {
    // A per-row quick action (e.g. 建任务) runs a WRITE as the user. The button lives in
    // sandboxed LLM-generated render code, which could auto-click it — so require an explicit
    // user confirm here (the host side, outside the sandbox) before forwarding to the background.
    const act = (d as { action?: { kind?: string; summary?: string } }).action
    const summary = act?.summary ? String(act.summary).slice(0, 200) : ''
    if (!confirm(`创建飞书任务：\n「${summary}」\n确认？`)) return
    try { chrome.runtime.sendMessage({ type: 'DATAVIZ_ROW_ACTION', vizId: idOf(target), action: act }) } catch { /* */ }
  }
}

/** Reverse-lookup an overlay's id (small map; only used on the row-action path). */
function idOf(o: Overlay): string {
  for (const [id, ov] of overlays) if (ov === o) return id
  return 'preview'
}

/** Background reported a write-back / row-action result → update the overlay chrome. */
export function writeResult(vizId: string, r: WriteResult) {
  const o = overlays.get(vizId)
  if (!o) return
  if (r.rowAction) {
    // A per-row action (建任务) shares this result channel but is unrelated to write-back. It must
    // NOT post DATAVIZ_WRITE_DONE (which clears the sandbox's drafts), NOT touch the 提交 button,
    // and NOT cancel the write-back's watchdog timer — otherwise a row action firing while a 提交
    // is in flight would discard staged edits or leave the button stuck if the SW later dies.
    flash(o, r.ok ? (r.note || '已完成') : '操作失败：' + (r.failed || '请重试'))
    return
  }
  if (o.submitTimer) { clearTimeout(o.submitTimer); o.submitTimer = undefined } // write-back result arrived → cancel watchdog
  if (r.ok) {
    o.iframe.contentWindow?.postMessage({ type: 'DATAVIZ_WRITE_DONE', nonce: o.nonce }, '*')
    o.pendingEdits = []
    o.submitBtn.style.display = 'none'
    flash(o, r.note || `已提交 ${r.done ?? 0} 项`)
  } else {
    const n = o.pendingEdits?.length ?? 0
    o.submitBtn.disabled = false
    if (n > 0) o.submitBtn.textContent = `⬆ 提交 ${n} 项修改`
    flash(o, '提交失败：' + (r.failed || '请重试'))
  }
}

/** Show (or reuse) the overlay for `vizId` and render the given code+data. */
export function renderViz(p: Payload) {
  if (!listening) { window.addEventListener('message', onWindowMessage); listening = true }
  const o = ensure(p.vizId)
  if (p.name) o.titleEl.textContent = '📊 ' + p.name
  o.source = p.source // single-table Base → editable; else undefined (write-back disabled)
  o.el.style.zIndex = String(++zTop) // bring to front
  if (o.ready) post(o, p)
  else o.pending = p
}

export function closeViz(vizId: string) { destroy(vizId) }
export function isVizOpen(vizId: string): boolean { return overlays.has(vizId) }
