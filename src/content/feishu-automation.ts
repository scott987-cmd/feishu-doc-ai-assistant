/**
 * UI automation for Feishu Base running inside the content script.
 * Uses text-content matching rather than obfuscated class names so it
 * survives Feishu CSS-module updates.
 */

const TIMEOUT = 5000

// ─── Helpers ─────────────────────────────────────────────────────────────────

function delay(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms))
}

async function waitFor<T>(fn: () => T | null | undefined, timeoutMs = TIMEOUT): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const v = fn()
    if (v != null) return v
    await delay(60)
  }
  throw new Error(`waitFor: timed out after ${timeoutMs}ms`)
}

/** Fire a real-feeling click that triggers React synthetic events */
function click(el: HTMLElement) {
  const opts = { bubbles: true, cancelable: true }
  el.dispatchEvent(new MouseEvent('mousedown', opts))
  el.dispatchEvent(new MouseEvent('mouseup', opts))
  el.dispatchEvent(new MouseEvent('click', opts))
}

/** Find first element whose visible text contains the given string */
function byText(selector: string, text: string, root: Element = document.body): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>(selector)) {
    if (el.textContent?.includes(text)) return el
  }
  return null
}

/** Type text into a focused input using synthetic key events so React state updates */
async function typeText(el: HTMLElement, text: string) {
  el.focus()
  // React tracks the nativeInputValueSetter to bypass the value-setting shortcut
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  )?.set
  nativeInputValueSetter?.call(el, text)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  await delay(100)
}

// ─── Dashboard creation ───────────────────────────────────────────────────────

export interface CreateDashboardResult {
  blockToken: string
  created: boolean
}

/**
 * Automates the Feishu Base UI to create a dashboard with the given name.
 * Returns the block_token extracted from the URL after navigation.
 */
export async function createDashboardUI(name: string): Promise<CreateDashboardResult> {
  // Check if a dashboard with this name already exists in the view sidebar
  const existing = findExistingDashboard(name)
  if (existing) {
    click(existing)
    await waitForDashboardUrl()
    const token = getDashboardTokenFromUrl()
    if (token) return { blockToken: token, created: false }
  }

  // Step 1: find and click the "add view" trigger
  const addBtn = await waitFor(() =>
    // Try multiple selectors — text is stable across UI updates
    byText('button, [role="button"], span[class*="add"]', '添加视图') ??
    byText('button, [role="button"]', '+ 视图') ??
    byText('button, [role="button"]', 'Add view') ??
    document.querySelector<HTMLElement>('[data-action*="add-view"], [class*="add-view-btn"]')
  , TIMEOUT)

  click(addBtn)

  // Step 2: wait for the view-type picker / dropdown to appear
  const dashboardOption = await waitFor(() =>
    byText('[role="option"], [role="menuitem"], li, [class*="option"]', '仪表盘') ??
    byText('[role="option"], [role="menuitem"], li, [class*="option"]', 'Dashboard')
  , TIMEOUT)

  click(dashboardOption)

  // Step 3: wait for the naming input (might appear immediately or in a modal)
  let named = false
  try {
    const input = await waitFor<HTMLInputElement>(() => {
      const el = document.querySelector<HTMLInputElement>(
        'input[placeholder*="名称"], input[placeholder*="name"], input[autofocus], input[class*="rename"]'
      )
      return el && el.offsetParent !== null ? el : null
    }, 2000)

    await typeText(input, name)

    // Confirm with Enter
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }))
    named = true
  } catch {
    // No naming input — Feishu might have auto-named it; rename it later
  }

  // Step 4: wait for URL to contain the new dashboard block_token
  const token = await waitForDashboardUrl()

  if (!named && token) {
    // Rename via double-click on the view tab
    await renameDashboard(name)
  }

  if (!token) throw new Error('创建仪表盘后未能从 URL 获取 block_token')
  return { blockToken: token, created: true }
}

// ─── Rename ───────────────────────────────────────────────────────────────────

async function renameDashboard(name: string) {
  try {
    // Double-click on the active view tab to enter rename mode
    const activeTab = document.querySelector<HTMLElement>(
      '[class*="view-tab"][class*="active"], [class*="tab"][aria-selected="true"]'
    )
    if (!activeTab) return
    activeTab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await delay(300)
    const input = await waitFor<HTMLInputElement>(() =>
      document.querySelector<HTMLInputElement>('input[class*="rename"], input[class*="tab-name"]')
    , 1500)
    await typeText(input, name)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }))
  } catch { /* rename failure is non-fatal */ }
}

// ─── URL helpers ─────────────────────────────────────────────────────────────

async function waitForDashboardUrl(timeoutMs = TIMEOUT): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const token = getDashboardTokenFromUrl()
    if (token) return token
    await delay(100)
  }
  return null
}

function getDashboardTokenFromUrl(): string | null {
  // Dashboard block tokens start with "blk" in Feishu Base URLs
  // URL: https://base.feishu.cn/base/{appToken}?table=blkXXXXXX
  const table = new URLSearchParams(location.search).get('table')
  return table?.startsWith('blk') ? table : null
}

function findExistingDashboard(name: string): HTMLElement | null {
  // Look through view tabs for one matching the name
  const tabs = document.querySelectorAll<HTMLElement>(
    '[class*="view-tab"], [class*="ViewTab"], [role="tab"]'
  )
  for (const tab of tabs) {
    if (tab.textContent?.trim() === name) return tab
  }
  return null
}
