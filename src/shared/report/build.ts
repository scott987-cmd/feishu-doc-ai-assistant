import type { AppSettings, PageContext } from '../types'
import type { VizSource } from '../dataviz/types'
import { resolveToken } from '../feishu/auth'
import { fetchVizData } from '../dataviz/data'
import * as API from '../feishu/api'
import { createDocFromMarkdown, insertTable } from '../feishu/docx'
import { BUILD_CONFIG } from '../config'
import { profileTable } from './profile'
import { generateReport } from '../ai/report'
import type { ReportResult } from './types'

const FETCH_CAP = 50  // sample + appended-table source (one read, sliced for both)
const SAMPLE_CAP = 30 // rows shown to the LLM
const ROW_CAP = 50    // rows in the appended data table
const COL_CAP = 12    // columns in the appended data table

/** Build a clickable doc URL from the current Feishu origin (private/on-prem safe). */
function docUrl(documentId: string, context: PageContext): string {
  const d = BUILD_CONFIG.feishuBaseDomain
  let origin = `https://${d}`
  try {
    const u = new URL(context.url)
    const h = u.hostname.toLowerCase()
    if (h === d || h.endsWith('.' + d)) origin = u.origin
  } catch { /* no usable page URL — use the configured host */ }
  return `${origin}/docx/${documentId}`
}

/** Transfer the new doc to the configured user (no-op without an owner; non-fatal). */
async function transferDoc(token: string, documentId: string, settings: AppSettings): Promise<void> {
  const owner = settings.feishuOwnerOpenId?.trim()
  if (!owner) return
  try { await API.transferBaseOwner(token, documentId, 'openid', owner, false, 'docx') } catch { /* keep the doc */ }
}

/**
 * Read the current table → profile it → LLM writes a narrative report → create a doc from
 * that markdown → append the source data as a doc table. Used by both the panel and the
 * chat tool. As the user (resolveToken); no new egress beyond the existing LLM + Feishu.
 */
export async function buildDataReport(
  settings: AppSettings,
  source: VizSource,
  focus: string,
  context: PageContext,
): Promise<ReportResult> {
  const token = await resolveToken(settings)
  const data = await fetchVizData(settings, source, FETCH_CAP)
  // Drop blank-named columns (a Sheet with empty header cells) so cells map cleanly.
  const schema = data.schema.filter((f) => f.name.trim())
  if (!schema.length) throw new Error('这张表没有可用的字段（请确认有表头）。')

  const profile = profileTable(schema, data.rows)
  const { title, markdown } = await generateReport(settings, {
    schema,
    profile,
    sampleRows: data.rows.slice(0, SAMPLE_CAP),
    focus: focus.trim() || undefined,
    sourceKind: source.kind,
  })

  const cols = schema.slice(0, COL_CAP)
  const truncCols = schema.length > COL_CAP
  const shownRows = Math.min(data.rows.length, ROW_CAP)
  // A caption as the LAST markdown line → it's part of blocks_inserted and renders right
  // above the appended table.
  const caption = `\n---\n*数据：前 ${shownRows} 行${truncCols ? `、前 ${COL_CAP} 列` : ''}，共 ${profile.rowCount} 行*`

  const created = (await createDocFromMarkdown(token, title, markdown + caption)) as {
    document?: { document_id?: string }; blocks_inserted?: number
  }
  const documentId = created.document?.document_id
  if (!documentId) throw new Error('文档创建失败。')

  // Append the data table AFTER the narrative. blocks_inserted is the count of root-level
  // markdown blocks (all flat), so it's the correct append index.
  let tableAppended = false
  const tableData: string[][] = [
    cols.map((f) => f.name),
    ...data.rows.slice(0, ROW_CAP).map((r) => cols.map((f) => r[f.name] ?? '')),
  ]
  if (tableData.length > 1) {
    try { await insertTable(token, documentId, tableData, created.blocks_inserted ?? 0); tableAppended = true }
    catch { /* the narrative doc still stands — appending the table is best-effort */ }
  }

  await transferDoc(token, documentId, settings)

  return {
    documentId,
    url: docUrl(documentId, context),
    title,
    rowsShown: shownRows,
    colsShown: cols.length,
    rowCount: profile.rowCount,
    tableAppended,
  }
}
