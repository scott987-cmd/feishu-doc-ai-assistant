/**
 * Minimal chrome.* mock so the side panel can run directly in a browser
 * without being loaded as an extension.
 *
 * State is persisted to localStorage so settings survive page refresh.
 */

const STORAGE_KEY = '__mock_chrome_storage__'

function loadFromLS(): Record<string, unknown> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') } catch { return {} }
}

const mem: Record<string, unknown> = loadFromLS()

// Simulate being on a Feishu Base page — edit to match your test app
const MOCK_PAGE_CONTEXT = {
  url: 'https://base.feishu.cn/base/MockAppToken?table=MockTableId&view=MockViewId',
  title: 'Mock Base — Dev',
  selectedText: '',
  feishu: {
    isBase: true,
    kind: 'base', // mirror parseFeishuContext — the UI keys context-aware behavior off `kind`
    appToken: 'MockAppToken',
    tableId: 'MockTableId',
    viewId: 'MockViewId',
  },
}

// The active page context — persisted to localStorage so a scenario survives the reload that
// switching scenarios triggers (otherwise the mock would reset to Base on every reload).
const SCENARIO_KEY = '__mock_scenario__'
function pageCtx(): typeof MOCK_PAGE_CONTEXT {
  try { const s = localStorage.getItem(SCENARIO_KEY); if (s) return JSON.parse(s) } catch { /* ignore */ }
  return MOCK_PAGE_CONTEXT
}

// An event slot the app can add/remove listeners on (the app cleans up on unmount; without
// removeListener it crashes under React 18 StrictMode's mount→cleanup→mount double-invoke).
const evt = () => ({ addListener: () => {}, removeListener: () => {} })
const onChanged = { addListener: () => {}, removeListener: () => {} }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(window as any).chrome = {
  runtime: {
    id: 'mock-extension-id-local-dev-0000',
    onMessage: evt(),
    sendMessage: () => Promise.resolve(null),
  },

  storage: {
    onChanged,
    local: {
      get(keys: string[], callback: (r: Record<string, unknown>) => void) {
        const result: Record<string, unknown> = {}
        for (const k of keys) if (k in mem) result[k] = mem[k]
        callback(result)
      },
      set(items: Record<string, unknown>, callback?: () => void) {
        Object.assign(mem, items)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(mem))
        callback?.()
      },
      remove(keys: string | string[], callback?: () => void) {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete mem[k]
        localStorage.setItem(STORAGE_KEY, JSON.stringify(mem))
        callback?.()
      },
    },
  },

  tabs: {
    query: () => Promise.resolve([{ id: 1, url: pageCtx().url }]),
    get: (id: number) => Promise.resolve({ id, active: true, url: pageCtx().url, title: pageCtx().title }),
    sendMessage: (_tabId: number, msg: { type: string }) => {
      if (msg.type === 'GET_PAGE_CONTEXT') return Promise.resolve(pageCtx())
      return Promise.resolve(null)
    },
    onActivated: evt(),
    onUpdated: evt(),
    create: () => {},
  },

  windows: { WINDOW_ID_NONE: -1, onFocusChanged: evt() },
  sidePanel: { open: () => {}, setPanelBehavior: () => {} },
  action: { onClicked: evt() },
  scripting: { executeScript: () => Promise.resolve([]) },
}

console.info('[dev] chrome mock loaded — storage persisted in localStorage')
