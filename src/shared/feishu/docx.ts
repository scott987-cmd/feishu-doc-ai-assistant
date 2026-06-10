/**
 * Feishu Docs (docx/v1) API wrapper.
 *
 * The document's root block id == document_id, so child blocks are appended under
 * that id. Block payloads are non-trivial (typed per block_type); `buildBlock`
 * turns simple {text, style} specs into the API's block structure so the agent
 * doesn't have to know the raw schema.
 *
 * Endpoints verified live before being relied on (see harness/docx.test.ts).
 */
import { feishuReq } from './http'
import { writeRange } from './sheets'

export type BlockStyle =
  | 'text' | 'h1' | 'h2' | 'h3' | 'bullet' | 'ordered' | 'quote' | 'code' | 'todo' | 'divider'
export interface BlockSpec { text: string; style?: BlockStyle }

// block_type codes (verified live): 2=text 3/4/5=heading1-3 12=bullet 13=ordered
// 14=code 15=quote 17=todo 22=divider
const BLOCK_TYPE: Record<BlockStyle, { type: number; key: string }> = {
  text: { type: 2, key: 'text' },
  h1: { type: 3, key: 'heading1' },
  h2: { type: 4, key: 'heading2' },
  h3: { type: 5, key: 'heading3' },
  bullet: { type: 12, key: 'bullet' },
  ordered: { type: 13, key: 'ordered' },
  quote: { type: 15, key: 'quote' },
  code: { type: 14, key: 'code' },
  todo: { type: 17, key: 'todo' },
  divider: { type: 22, key: 'divider' },
}

// Parse inline markdown (**bold**, *italic*, `code`) into styled text_run elements.
function parseInline(text: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text_run: { content: text.slice(last, m.index) } })
    const style = m[2] != null ? { bold: true } : m[3] != null ? { italic: true } : { inline_code: true }
    out.push({ text_run: { content: m[2] ?? m[3] ?? m[4], text_element_style: style } })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text_run: { content: text.slice(last) } })
  return out.length ? out : [{ text_run: { content: text } }]
}

export function buildBlock(spec: BlockSpec): Record<string, unknown> {
  const { type, key } = BLOCK_TYPE[spec.style ?? 'text'] ?? BLOCK_TYPE.text
  if (key === 'divider') return { block_type: type, divider: {} }
  const inner: Record<string, unknown> = { elements: parseInline(spec.text), style: {} }
  if (key === 'todo') (inner.style as Record<string, unknown>).done = false
  return { block_type: type, [key]: inner }
}

// ─── Markdown → blocks ──────────────────────────────────────────────────────

/** Convert a markdown string into BlockSpec[] (block-level + inline bold/italic/code). */
export function markdownToBlocks(md: string): BlockSpec[] {
  const blocks: BlockSpec[] = []
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  let inCode = false
  let codeBuf: string[] = []
  for (const raw of lines) {
    const line = raw
    if (line.trim().startsWith('```')) {
      if (inCode) { blocks.push({ text: codeBuf.join('\n'), style: 'code' }); codeBuf = []; inCode = false }
      else inCode = true
      continue
    }
    if (inCode) { codeBuf.push(line); continue }
    const tr = line.trim()
    if (!tr) continue
    if (/^(---|\*\*\*|___)$/.test(tr)) { blocks.push({ text: '', style: 'divider' }); continue }
    let mm: RegExpMatchArray | null
    if ((mm = tr.match(/^(#{1,3})\s+(.*)$/))) {
      blocks.push({ text: mm[2], style: (['h1', 'h2', 'h3'] as const)[mm[1].length - 1] })
    } else if ((mm = tr.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/))) {
      blocks.push({ text: mm[2], style: 'todo' })
    } else if ((mm = tr.match(/^[-*+]\s+(.*)$/))) {
      blocks.push({ text: mm[1], style: 'bullet' })
    } else if ((mm = tr.match(/^\d+\.\s+(.*)$/))) {
      blocks.push({ text: mm[1], style: 'ordered' })
    } else if ((mm = tr.match(/^>\s?(.*)$/))) {
      blocks.push({ text: mm[1], style: 'quote' })
    } else {
      blocks.push({ text: tr, style: 'text' })
    }
  }
  if (inCode && codeBuf.length) blocks.push({ text: codeBuf.join('\n'), style: 'code' })
  return blocks
}

// ─── Documents ──────────────────────────────────────────────────────────────

export function createDocument(token: string, title: string, folderToken?: string) {
  return feishuReq('POST', '/docx/v1/documents', token, {
    title,
    ...(folderToken ? { folder_token: folderToken } : {}),
  })
}

/** Create a document and fill it from a markdown string in one call. */
export async function createDocFromMarkdown(
  token: string,
  title: string,
  markdown: string,
  folderToken?: string
) {
  const created = (await createDocument(token, title, folderToken)) as {
    document?: { document_id?: string }
  }
  const docId = created.document?.document_id
  const blocks = markdownToBlocks(markdown)
  if (docId && blocks.length) await insertBlocks(token, docId, blocks, 0)
  return { ...created, blocks_inserted: blocks.length }
}

/** Plain-text dump of the whole document. */
export function getDocumentContent(token: string, documentId: string) {
  return feishuReq('GET', `/docx/v1/documents/${documentId}/raw_content`, token)
}

/** Document metadata (mainly the real title). Used to name a direct /docx/ page reliably —
 *  the SPA's document.title is unreliable on some (esp. private/on-prem) deployments. */
export function getDocumentMeta(token: string, documentId: string) {
  return feishuReq('GET', `/docx/v1/documents/${documentId}`, token) as Promise<{ document?: { title?: string } }>
}

/** List a document's blocks, following pagination so large docs aren't silently truncated
 *  (the agent computes block indices off this view — a single page would hide blocks past #500). */
export async function listBlocks(token: string, documentId: string, cap = 2000) {
  const items: unknown[] = []
  let pageToken: string | undefined
  let truncated = false
  do {
    const res = (await feishuReq('GET', `/docx/v1/documents/${documentId}/blocks`, token, undefined, {
      page_size: '500',
      ...(pageToken ? { page_token: pageToken } : {}),
    })) as { items?: unknown[]; has_more?: boolean; page_token?: string }
    if (Array.isArray(res.items)) items.push(...res.items)
    pageToken = res.has_more ? res.page_token : undefined
    if (items.length >= cap) { truncated = !!pageToken; pageToken = undefined } // bound context size
  } while (pageToken)
  return { items: items.slice(0, cap), has_more: truncated, truncated }
}

/** Insert built blocks under a parent (default: document root) at `index`. Feishu caps the
 *  children array at 50 per call, so we CHUNK — inserting each chunk at the running offset.
 *  Without this, a wide report/audit/summary left a blank doc + a confusing API error. */
export async function insertBlocks(
  token: string,
  documentId: string,
  specs: BlockSpec[],
  index = 0,
  parentBlockId?: string
) {
  const parent = parentBlockId ?? documentId
  const children = specs.map(buildBlock)
  const CHUNK = 50
  const created: Array<{ block_id?: string }> = []
  for (let i = 0; i < children.length; i += CHUNK) {
    const res = (await feishuReq('POST', `/docx/v1/documents/${documentId}/blocks/${parent}/children`, token, {
      index: index + i,
      children: children.slice(i, i + CHUNK),
    })) as { children?: Array<{ block_id?: string }> }
    if (Array.isArray(res.children)) created.push(...res.children)
  }
  return { children: created, blocks_inserted: children.length }
}

// ─── Tables (one-shot, fully populated via the descendant endpoint) ─────────

interface Descendant { block_id: string; block_type: number; children?: string[]; [k: string]: unknown }

/**
 * Build the `descendant` payload for a populated table — table(31) → cells(32) → text(2),
 * in ROW-MAJOR order. Pure (no I/O), so it's unit-tested. Feishu REQUIRES every table cell
 * to contain ≥1 child block, so even an empty cell gets an (empty) text block.
 */
export function buildTableDescendants(
  data: string[][],
  opts: { headerRow?: boolean } = {},
): { children_id: string[]; descendants: Descendant[]; rows: number; cols: number } {
  const rows = data.length
  const cols = Math.max(1, ...data.map((r) => r.length))
  const cellIds: string[] = []
  const cells: Descendant[] = []
  const texts: Descendant[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cellId = `c_${r}_${c}`
      const textId = `t_${r}_${c}`
      cellIds.push(cellId)
      cells.push({ block_id: cellId, block_type: 32, table_cell: {}, children: [textId] })
      const content = data[r]?.[c] ?? ''
      texts.push({
        block_id: textId, block_type: 2,
        text: { elements: content ? parseInline(content) : [{ text_run: { content: '' } }], style: {} },
        children: [],
      })
    }
  }
  const table: Descendant = {
    block_id: 'tbl', block_type: 31,
    table: { property: { row_size: rows, column_size: cols, header_row: opts.headerRow ?? true } },
    children: cellIds,
  }
  return { children_id: ['tbl'], descendants: [table, ...cells, ...texts], rows, cols }
}

/**
 * Insert a TABLE filled with `data` (string[][]) in ONE call via the descendant endpoint.
 * Replaces the old create-empty-then-PATCH approach, which fired N+1 rate-limited writes
 * AND relied on a non-paginated listBlocks — so on a doc with >500 blocks the new cells
 * fell outside the first page and were silently left empty.
 */
export async function insertTable(token: string, documentId: string, data: string[][], index = 0) {
  if (!data.length) return { table_block_id: null, rows: 0, cols: 0 }
  const { children_id, descendants, rows, cols } = buildTableDescendants(data, { headerRow: true })
  const res = (await feishuReq(
    'POST',
    `/docx/v1/documents/${documentId}/blocks/${documentId}/descendant`,
    token,
    { index, children_id, descendants },
  )) as { children?: Array<{ block_id: string }> }
  return { table_block_id: res.children?.[0]?.block_id ?? null, rows, cols }
}

// ─── Embedded spreadsheet (电子表格, block_type 30) ──────────────────────────

/** Split a docx Sheet-block token `{spreadsheetToken}_{sheetId}` on the LAST underscore. */
export function splitSheetToken(token: string): { spreadsheetToken: string; sheetId: string } | null {
  const i = token.lastIndexOf('_')
  if (i <= 0 || i >= token.length - 1) return null
  return { spreadsheetToken: token.slice(0, i), sheetId: token.slice(i + 1) }
}

function colLetter(n: number): string {
  let s = ''
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s
  return s
}

/**
 * Embed a NEW spreadsheet (电子表格) into the document and optionally fill it with `data`.
 * Creating a Sheet block (30) AUTO-creates a fresh spreadsheet; its token comes back as
 * `{spreadsheetToken}_{sheetId}`. The block-create caps at 9×9, so we create within that
 * and write the full data through the Sheets values API (which grows the grid).
 */
export async function insertSheet(token: string, documentId: string, data: string[][] = [], index = 0) {
  const rows = data.length || 5
  const cols = data.length ? Math.max(1, ...data.map((r) => r.length)) : 4
  const created = (await feishuReq(
    'POST',
    `/docx/v1/documents/${documentId}/blocks/${documentId}/children`,
    token,
    { index, children: [{ block_type: 30, sheet: { row_size: Math.min(rows, 9), column_size: Math.min(cols, 9) } }] },
  )) as { children?: Array<{ block_id: string; sheet?: { token?: string } }> }
  const block = created.children?.[0]
  const parsed = block?.sheet?.token ? splitSheetToken(block.sheet.token) : null
  // If there's data to write but the embedded-sheet token didn't parse, FAIL LOUDLY — otherwise
  // we'd return a success shape with an empty sheet and the agent would report it as filled.
  if (data.length && !parsed) {
    throw new Error('无法解析嵌入表格 token，数据未写入（请重试或手动填充该表格）')
  }
  if (data.length && parsed) {
    const range = `${parsed.sheetId}!A1:${colLetter(cols)}${rows}`
    await writeRange(token, parsed.spreadsheetToken, range, data)
  }
  return {
    sheet_block_id: block?.block_id ?? null,
    spreadsheet_token: parsed?.spreadsheetToken ?? null,
    sheet_id: parsed?.sheetId ?? null,
    rows, cols,
  }
}

/** Delete a contiguous range of child blocks [startIndex, endIndex). */
export function deleteBlocks(
  token: string,
  documentId: string,
  parentBlockId: string,
  startIndex: number,
  endIndex: number
) {
  return feishuReq(
    'DELETE',
    `/docx/v1/documents/${documentId}/blocks/${parentBlockId}/children/batch_delete`,
    token,
    { start_index: startIndex, end_index: endIndex }
  )
}
