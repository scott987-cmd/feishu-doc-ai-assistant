import type { PageContext } from '../types'

/**
 * Parse a Feishu resource context out of a page URL — Base (多维表格), Spreadsheet
 * (电子表格) or Doc (文档). Used by both the content script (location.href) and the
 * side panel as a fallback when the content script isn't injected.
 *   /base/{appToken}?table=&view=   → Base
 *   /sheets/{spreadsheetToken}      → Spreadsheet
 *   /docx|docs/{documentId}         → Doc
 * (/wiki/ wraps another type and needs an API lookup to resolve — not handled here.)
 */
export function parseFeishuContext(url: string): PageContext['feishu'] | undefined {
  const base = url.match(/\/base\/([A-Za-z0-9]+)/)
  if (base) {
    const qIdx = url.indexOf('?')
    const params = new URLSearchParams(qIdx >= 0 ? url.slice(qIdx) : '')
    return {
      isBase: true,
      kind: 'base',
      appToken: base[1],
      tableId: params.get('table') ?? undefined,
      viewId: params.get('view') ?? undefined,
    }
  }
  const sheet = url.match(/\/sheets\/([A-Za-z0-9]+)/)
  if (sheet) return { isBase: false, kind: 'sheet', spreadsheetToken: sheet[1] }

  const doc = url.match(/\/(?:docx|docs)\/([A-Za-z0-9]+)/)
  if (doc) return { isBase: false, kind: 'doc', documentId: doc[1] }

  // Wiki node wraps a doc/sheet/base — needs an API lookup to resolve the real type.
  const wiki = url.match(/\/wiki\/([A-Za-z0-9]+)/)
  if (wiki) return { isBase: false, kind: 'wiki', wikiToken: wiki[1] }

  return undefined
}

/**
 * Turn a browser tab title into a clean document name: strip the trailing
 * "- 飞书云文档 / - Feishu Docs / - Lark Sheets" suffix, and reject the placeholder
 * titles ("飞书", "Loading", empty) that Feishu's SPA briefly shows DURING navigation —
 * those used to get written as the session name, which is the visible "unstable name" bug.
 * Returns '' when the title isn't a real, settled name (caller should then keep the old one).
 */
export function cleanDocTitle(title: string): string {
  // Some (esp. private/on-prem) doc pages briefly expose the URL itself as document.title —
  // never use a URL as the doc name (it produced "name = full URL" on kastd01.*).
  if (/^https?:\/\//i.test((title || '').trim())) return ''
  const name = (title || '')
    // SaaS / Lark brand suffix: "… - 飞书云文档" / "… - Feishu Docs" / "… - Lark".
    .replace(/\s*[-–—|]\s*(飞书|feishu|lark)[^-–—|]*$/i, '')
    // Private/on-prem brand suffix: "… - <品牌>云文档 / 云空间 / Docs / Sheets / Wiki". Anchored to
    // these PRODUCT words (not bare 文档/表格) after a separator, so a real doc named e.g.
    // "项目文档" isn't truncated.
    .replace(/\s*[-–—|]\s*[^-–—|]*?(云文档|云空间|Docs?|Sheets?|Wiki)\s*$/i, '')
    .trim()
  if (!name || /^(飞书|feishu|lark|飞书云文档|云文档|loading|加载中)$/i.test(name)) return ''
  return name
}
