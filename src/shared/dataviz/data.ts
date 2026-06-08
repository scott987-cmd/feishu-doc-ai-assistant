import type { AppSettings, PageContext } from '../types'
import { resolveToken } from '../feishu/auth'
import { fetchBaseCtx } from '../feishu/context'
import { fetchAllRecords, cellToString } from '../feishu/compose'
import { readRange, listSheets } from '../feishu/sheets'
import type { VizSource, VizData, VizField, VizDataset } from './types'

/** A1 column letter for a 1-based column index (1→A, 27→AA), clamped to a sane max. */
const colLetter = (n: number): string => {
  let r = ''; let k = Math.max(1, Math.min(n, 702))
  while (k > 0) { r = String.fromCharCode(65 + (k - 1) % 26) + r; k = Math.floor((k - 1) / 26) }
  return r
}
/** Full-grid A1 range for a worksheet, capped to `cap` data rows. */
function sheetRange(sid: string, gp: { row_count?: number; column_count?: number } | undefined, cap: number): string {
  const rows = Math.min(gp?.row_count ?? 1000, cap + 1)
  return `${sid}!A1:${colLetter(gp?.column_count ?? 26)}${rows}`
}
/**
 * Infer a Sheets column's type from sampled cell strings. Spreadsheets carry NO per-field
 * type metadata (everything used to be flagged 'Text'), so the model couldn't tell a date
 * column from a label. We sniff Number / Percent / DateTime by majority so the prompt can
 * advise time-series / formatted axes just like it does for typed Base fields.
 */
export function inferColType(values: string[]): string {
  const vals = values.filter((v) => v.trim() !== '')
  if (!vals.length) return 'Text'
  let num = 0, date = 0, pct = 0
  for (const raw of vals) {
    const v = raw.trim()
    // else-if chain: a single-dot decimal like '2024.5' is a Number, NOT a date — count it once.
    // Multi-part dates ('2024.05.12') don't match the number regex, so they fall through to date.
    if (/^-?[\d,]+(\.\d+)?\s*%$/.test(v)) pct++
    else if (/^-?[¥$€]?\s*[\d,]+(\.\d+)?$/.test(v)) num++
    else if (/^\d{4}[-/.]\d{1,2}([-/.]\d{1,2})?([ T]\d{1,2}:\d{2})?$/.test(v)) date++
  }
  const tot = vals.length
  if (date / tot >= 0.7) return 'DateTime'
  if (pct / tot >= 0.7) return 'Percent'
  if (num / tot >= 0.7) return 'Number'
  return 'Text'
}

/** Up to `n` distinct, non-empty sample values per field, read off the fetched rows — so the
 *  prompt can show the model the REAL formats (date layout, currency style, option labels). */
function attachSamples(schema: VizField[], rows: Record<string, string>[], n = 3): VizField[] {
  return schema.map((f) => {
    const seen = new Set<string>()
    for (const r of rows) {
      const v = r[f.name]
      if (v && v.trim() && !seen.has(v)) { seen.add(v); if (seen.size >= n) break }
    }
    return seen.size ? { ...f, samples: Array.from(seen) } : f
  })
}

/** Sheet cell matrix (row 0 = headers) → {schema, rows}; per-column type is sniffed (see inferColType). */
function sheetValuesToData(values: unknown[][], cap: number): VizData {
  const headers = (values[0] ?? []).map((v) => cellToString(v))
  const rows = values.slice(1, cap + 1).map((row) => {
    const o: Record<string, string> = {}
    headers.forEach((h, i) => { o[h] = cellToString(row[i]) })
    return o
  })
  const schema = headers.map((h) => ({ name: h, type: inferColType(rows.map((r) => r[h])) }))
  return { schema: attachSamples(schema, rows), rows }
}
/** Base records → flat string-cell rows, keyed by the schema field names. `__rid` carries the
 *  record_id (hidden — `ui.*` only renders declared columns) so a generated site can write back. */
function baseRecordsToRows(records: Array<{ record_id?: string; fields?: unknown }>, schema: VizField[]): Record<string, string>[] {
  return records.map((r) => {
    const fields = (r.fields ?? {}) as Record<string, unknown>
    const o: Record<string, string> = {}
    if (r.record_id) o.__rid = r.record_id
    for (const f of schema) o[f.name] = cellToString(fields[f.name])
    return o
  })
}

/** Doc identity (for fetchDocDatasets) extracted from a viz's primary source. */
export function docOf(source: VizSource): { kind: 'base'; appToken: string; tableId: string } | { kind: 'sheet'; spreadsheetToken: string } {
  return source.kind === 'base'
    ? { kind: 'base', appToken: source.appToken, tableId: source.tableId }
    : { kind: 'sheet', spreadsheetToken: source.spreadsheetToken }
}

/** Derive a viz source from the current Feishu page context (Base table or first worksheet). */
export async function deriveVizSource(
  settings: AppSettings,
  feishu: NonNullable<PageContext['feishu']>,
): Promise<VizSource | null> {
  const token = await resolveToken(settings)
  if (feishu.kind === 'base' && feishu.appToken) {
    let tableId = feishu.tableId
    if (!tableId) {
      const ctx = await fetchBaseCtx(token, feishu.appToken)
      tableId = ctx.currentTableId || ctx.tables[0]?.tableId
    }
    return tableId ? { kind: 'base', appToken: feishu.appToken, tableId } : null
  }
  if (feishu.kind === 'sheet' && feishu.spreadsheetToken) {
    const meta = (await listSheets(token, feishu.spreadsheetToken)) as {
      sheets?: Array<{ sheet_id?: string; sheetId?: string; grid_properties?: { row_count?: number; column_count?: number } }>
    }
    const s = meta.sheets?.[0]
    const sid = s?.sheet_id || s?.sheetId
    if (!sid) return null
    return { kind: 'sheet', spreadsheetToken: feishu.spreadsheetToken, range: sheetRange(sid, s?.grid_properties, 2000) }
  }
  return null
}

/**
 * Fetch the LIVE table data for a viz source, flattened to string cells. Reused for both
 * the codegen sample (small cap) and the actual render (larger cap). No new egress — this
 * is the same user-identity Feishu read the chat already does.
 */
export async function fetchVizData(settings: AppSettings, source: VizSource, cap = 2000): Promise<VizData> {
  const token = await resolveToken(settings)

  if (source.kind === 'base') {
    const ctx = await fetchBaseCtx(token, source.appToken, source.tableId)
    const table = ctx.tables.find((t) => t.tableId === source.tableId) ?? ctx.tables[0]
    const schema = (table?.fields ?? []).map((f) => ({ name: f.fieldName, type: f.typeName }))
    const records = await fetchAllRecords(token, source.appToken, source.tableId, cap)
    const rows = baseRecordsToRows(records, schema)
    return { schema: attachSamples(schema, rows), rows }
  }

  // Sheet: first row = headers, rest = data.
  const res = (await readRange(token, source.spreadsheetToken, source.range)) as { valueRange?: { values?: unknown[][] } }
  return sheetValuesToData(res.valueRange?.values ?? [], cap)
}

/**
 * Fetch EVERY sub-table of the doc (all Base data-tables / all Spreadsheet worksheets) so a
 * generated site can LINK them. The primary (current) sub-table is index 0. Capped to keep the
 * payload sane — callers pass a small cap for the codegen sample, a larger one for the render.
 */
export async function fetchDocDatasets(
  settings: AppSettings,
  doc: { kind: 'base'; appToken: string; tableId?: string } | { kind: 'sheet'; spreadsheetToken: string },
  capPerTable = 1000,
  maxTables = 6,
): Promise<VizDataset[]> {
  const token = await resolveToken(settings)
  const out: VizDataset[] = []

  if (doc.kind === 'base') {
    const ctx = await fetchBaseCtx(token, doc.appToken, doc.tableId)
    const curId = doc.tableId || ctx.currentTableId
    // Respect the maxTables cap but ALWAYS include the current table — fetchBaseCtx appends it
    // beyond the top-6, so a plain slice(0,6) would DROP it and the site/report would be built
    // on the wrong (first) table.
    let tables = ctx.tables.slice(0, maxTables)
    if (curId && !tables.some((t) => t.tableId === curId)) {
      const cur = ctx.tables.find((t) => t.tableId === curId)
      if (cur) tables = [...tables, cur]
    }
    // Sub-tables are independent reads → fetch them concurrently (Promise.all preserves order,
    // so the current-table-first reorder below still works). Was a sequential for-of = sum of
    // every table's paginated fetch time.
    const built = (await Promise.all(
      tables.map(async (t) => {
        const schema = (t.fields ?? []).map((f) => ({ name: f.fieldName, type: f.typeName }))
        if (!schema.length) return null
        const records = await fetchAllRecords(token, doc.appToken, t.tableId, capPerTable)
        const rows = baseRecordsToRows(records, schema)
        return { ds: { name: t.tableName, schema: attachSamples(schema, rows), rows }, tableId: t.tableId }
      })
    )).filter((b): b is { ds: VizDataset; tableId: string } => b !== null)
    // Put the current table first (match by tableId — table names aren't unique) so datasets[0]
    // / `data` is what the user is looking at.
    const ci = built.findIndex((b) => b.tableId === curId)
    if (ci > 0) built.unshift(...built.splice(ci, 1))
    return dedupeNames(built.map((b) => b.ds))
  }

  const meta = (await listSheets(token, doc.spreadsheetToken)) as {
    sheets?: Array<{ sheet_id?: string; sheetId?: string; title?: string; grid_properties?: { row_count?: number; column_count?: number } }>
  }
  for (const s of (meta.sheets ?? []).slice(0, maxTables)) {
    const sid = s.sheet_id || s.sheetId
    if (!sid) continue
    const res = (await readRange(token, doc.spreadsheetToken, sheetRange(sid, s.grid_properties, capPerTable))) as { valueRange?: { values?: unknown[][] } }
    const { schema, rows } = sheetValuesToData(res.valueRange?.values ?? [], capPerTable)
    if (!schema.length) continue // skip empty worksheets
    out.push({ name: s.title || sid, schema, rows })
  }
  return dedupeNames(out)
}

/** Ensure dataset names are unique (Feishu allows duplicate table / worksheet names) so the
 *  generated site's BY-NAME dataset map (Object.fromEntries(ds.map(d => [d.name, d.rows]))) can't
 *  silently drop a collision (last-wins) or feed the wrong table's rows. */
function dedupeNames(list: VizDataset[]): VizDataset[] {
  const seen = new Map<string, number>()
  return list.map((d) => {
    const base = d.name || '未命名'
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n === 1 ? { ...d, name: base } : { ...d, name: `${base} (${n})` }
  })
}
