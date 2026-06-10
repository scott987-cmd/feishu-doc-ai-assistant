import type { PageContext } from '../shared/types'
import { parseFeishuContext } from '../shared/feishu/pageUrl'
import { createDashboardUI } from './feishu-automation'
import { renderViz, closeViz, writeResult } from './viz-overlay'
import { refreshLauncher } from './viz-launcher'

function extractContext(selOverride?: string): PageContext {
  const url = location.href
  return {
    url,
    title: document.title,
    selectedText: selOverride ?? (window.getSelection()?.toString().trim() ?? ''),
    feishu: parseFeishuContext(url),
  }
}

// Feishu Base field headers / cells are CLICKED, not text-selected — getSelection() stays
// empty. So on a plain click we grab the clicked element's own short text (the field name
// / cell value) by climbing to the nearest element with a short, single-line label.
function clickedLabel(target: EventTarget | null): string {
  let el = target instanceof Element ? target : null
  for (let i = 0; i < 5 && el; i++) {
    const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (t && t.length <= 60 && !t.includes('\n')) return t
    el = el.parentElement
  }
  return ''
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only accept messages from our own extension — reject all external origins
  if (sender.id !== chrome.runtime.id) return false

  if (msg.type === 'GET_PAGE_CONTEXT') {
    sendResponse(extractContext())
    return true
  }
  if (msg.type === 'CREATE_DASHBOARD_UI') {
    createDashboardUI(msg.name as string)
      .then(sendResponse)
      .catch(() => sendResponse(null))
    return true
  }
  if (msg.type === 'DATAVIZ_RENDER') {
    renderViz({ vizId: msg.vizId ?? 'preview', code: msg.code, spec: msg.spec, data: msg.data, datasets: msg.datasets, theme: msg.theme, name: msg.name, source: msg.source, fieldTypes: msg.fieldTypes })
    return false
  }
  if (msg.type === 'DATAVIZ_WRITE_RESULT') {
    // Background finished a write-back / row-action it ran for this overlay → update its chrome.
    writeResult(msg.vizId ?? 'preview', { ok: msg.ok, done: msg.done, failed: msg.failed, remaining: msg.remaining, note: msg.note, rowAction: msg.rowAction })
    return false
  }
  if (msg.type === 'DATAVIZ_CLOSE') {
    closeViz(msg.vizId ?? 'preview')
    return false
  }
})

function pushContext() {
  try { chrome.runtime.sendMessage({ type: 'PAGE_CONTEXT_UPDATE', payload: extractContext() }) } catch { /* ignore */ }
}

let lastUrl = location.href
let lastTitle = document.title
let pushTimer: ReturnType<typeof setTimeout> | undefined
function pushSoon(delay = 150) { clearTimeout(pushTimer); pushTimer = setTimeout(pushContext, delay) }

// SPA navigation: a content script runs in an ISOLATED world and can't hook the page's
// history API, so we detect URL changes by watching the DOM. Debounced.
const navObserver = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href
    void refreshLauncher() // resource changed → re-check for a saved viz launcher
    pushSoon()
  }
})
navObserver.observe(document.documentElement, { subtree: true, childList: true })

// Feishu updates document.title a beat AFTER the route changes, so a push fired on the URL
// change carries the PREVIOUS doc's name. Watch <head>/<title> and re-push when the real
// name lands — this is what keeps doc name/type recognition stable across in-app navigation.
if (document.head) {
  new MutationObserver(() => {
    if (document.title !== lastTitle) { lastTitle = document.title; pushSoon() }
  }).observe(document.head, { childList: true, subtree: true, characterData: true })
}

// Show the saved-viz launcher pill on first load (if this resource has one).
void refreshLauncher()

// Push the picked field/cell/text to the side panel right after a click or selection — so
// "click a field → it fills the chat input → describe the edit" works immediately, not
// only when the SPA URL happens to change. Debounced; only pushes on real changes.
let lastSel = ''
let selTimer: ReturnType<typeof setTimeout> | undefined
document.addEventListener('mouseup', (e) => {
  clearTimeout(selTimer)
  const target = e.target
  selTimer = setTimeout(() => {
    // Prefer a real text selection (drag); fall back to the clicked label (single click).
    const sel = (window.getSelection()?.toString().trim() || '') || clickedLabel(target)
    if (!sel || sel === lastSel) return
    lastSel = sel
    try { chrome.runtime.sendMessage({ type: 'PAGE_CONTEXT_UPDATE', payload: extractContext(sel) }) } catch { /* ignore */ }
  }, 200)
})
