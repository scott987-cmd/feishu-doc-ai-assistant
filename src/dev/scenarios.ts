/**
 * Switch mock scenarios from browser devtools console during dev:ui.
 *
 *   scenarios.base('MyAppToken', 'MyTableId')   // on a Base page
 *   scenarios.nonBase()                          // on a regular page
 *   scenarios.clearStorage()                     // reset all settings
 */

import type { PageContext } from '../shared/types'

const SCENARIO_KEY = '__mock_scenario__'
/** Persist the page context so it survives the reload (chrome-mock reads it back). */
function setScenario(ctx: PageContext | null, label: string) {
  if (ctx) localStorage.setItem(SCENARIO_KEY, JSON.stringify(ctx))
  else localStorage.removeItem(SCENARIO_KEY)
  console.info('[dev] scenario:', label, ctx?.feishu)
  window.location.reload()
}

export const scenarios = {
  base(appToken = 'TestAppToken', tableId = 'TestTableId', viewId = 'TestViewId') {
    setScenario({
      url: `https://base.feishu.cn/base/${appToken}?table=${tableId}&view=${viewId}`,
      title: 'Dev — 多维表格', selectedText: '',
      feishu: { isBase: true, kind: 'base', appToken, tableId, viewId },
    }, 'base')
  },

  sheet(spreadsheetToken = 'TestSheetToken') {
    setScenario({
      url: `https://example.feishu.cn/sheets/${spreadsheetToken}`,
      title: 'Dev — 电子表格', selectedText: '',
      feishu: { isBase: false, kind: 'sheet', spreadsheetToken },
    }, 'sheet')
  },

  doc(documentId = 'TestDocId') {
    setScenario({
      url: `https://example.feishu.cn/docx/${documentId}`,
      title: 'Dev — 飞书文档', selectedText: '',
      feishu: { isBase: false, kind: 'doc', documentId },
    }, 'doc')
  },

  nonBase(url = 'https://www.example.com') {
    setScenario({ url, title: 'Non-Base Page', selectedText: '' }, 'non-base')
  },

  clearStorage() {
    localStorage.removeItem('__mock_chrome_storage__')
    localStorage.removeItem(SCENARIO_KEY)
    console.info('[dev] storage cleared')
    window.location.reload()
  },
}

// Expose globally for console access
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(window as any).scenarios = scenarios
