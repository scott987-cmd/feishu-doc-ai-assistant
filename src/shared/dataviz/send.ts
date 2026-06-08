/**
 * Deliver a DATAVIZ_RENDER to the active tab's content script (which hosts the overlay).
 *
 * Chrome throws "Could not establish connection. Receiving end does not exist." when the
 * tab has no live content script — typically because the page was open BEFORE the extension
 * was (re)loaded, orphaning its content script. We recover by injecting the content script
 * on demand (we hold host permission for Feishu pages) and retrying once; if that still
 * fails, we surface an actionable "refresh the page" error.
 */
export async function sendVizToActiveTab(payload: {
  code: string
  data: unknown[]
  /** Optional named sub-tables (multi-sheet sites) — the render gets them as the `datasets` map. */
  datasets?: Record<string, unknown[]>
  name: string
  theme: 'light' | 'dark'
  /** Set only for a single-table Base site → enables editable cells / write-back in the overlay. */
  source?: { kind: 'base'; appToken: string; tableId: string }
  /** fieldName → Feishu typeName (with `source`) so edited cells are coerced to the right type. */
  fieldTypes?: Record<string, string>
}): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('找不到当前标签页。')
  // Generated/preview renders use a stable 'preview' window (re-generate/adjust updates it
  // in place); saved dashboards open their own window keyed by their id (via the background).
  const msg = { type: 'DATAVIZ_RENDER', vizId: 'preview', ...payload }

  try {
    await chrome.tabs.sendMessage(tab.id, msg)
    return
  } catch {
    // No live content script — inject it and retry.
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/index.js'] })
    await new Promise((r) => setTimeout(r, 60)) // let the script register its listener
    await chrome.tabs.sendMessage(tab.id, msg)
  } catch {
    throw new Error('无法连接当前页面。请刷新这个飞书页面后重试（扩展更新后，更新前已打开的页面需要刷新一次）。')
  }
}
