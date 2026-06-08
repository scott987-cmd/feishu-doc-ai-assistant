import type { AppSettings, PageContext } from '../types'
import { resolveToken } from '../feishu/auth'
import * as API from '../feishu/api'
import { listSheets, readRange } from '../feishu/sheets'
import { fetchAllRecords, cellToString } from '../feishu/compose'
import { isFillable } from './coerce'
import type { FillField, FillRecord, FillSource } from './types'

const READ_CAP = 5000

/** 1-based column index → spreadsheet column letter (1→A, 27→AA). */
function colLetter(n: number): string {
  let s = ''
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s
  return s
}

/**
 * Resolve the Smart Fill source for the current page — a Base table or the first worksheet
 * of a Spreadsheet. Light-weight: a Base uses the table id already in the URL when present
 * (else one listTables); a Sheet reads its grid bounds to build a read range. Null otherwise.
 */
export async function resolveFillSource(
  settings: AppSettings,
  feishu: NonNullable<PageContext['feishu']>,
): Promise<FillSource | null> {
  if (feishu.kind === 'base' && feishu.appToken) {
    const appToken = feishu.appToken
    if (feishu.tableId) return { kind: 'base', appToken, tableId: feishu.tableId }
    const token = await resolveToken(settings)
    const res = (await API.listTables(token, appToken)) as { items?: Array<{ table_id: string }> }
    const tableId = res.items?.[0]?.table_id
    return tableId ? { kind: 'base', appToken, tableId } : null
  }
  if (feishu.kind === 'sheet' && feishu.spreadsheetToken) {
    const token = await resolveToken(settings)
    const meta = (await listSheets(token, feishu.spreadsheetToken)) as {
      sheets?: Array<{ sheet_id?: string; sheetId?: string; grid_properties?: { row_count?: number; column_count?: number } }>
    }
    const s = meta.sheets?.[0]
    const sheetId = s?.sheet_id || s?.sheetId
    if (!sheetId) return null
    const rows = Math.min(s?.grid_properties?.row_count ?? 1000, READ_CAP + 1)
    const cols = Math.min(s?.grid_properties?.column_count ?? 26, 200)
    return { kind: 'sheet', spreadsheetToken: feishu.spreadsheetToken, sheetId, range: `${sheetId}!A1:${colLetter(cols)}${rows}` }
  }
  return null
}

interface RawField {
  field_id: string
  field_name: string
  type: number
  property?: { options?: Array<{ name: string }> }
}
const mapBaseField = (f: RawField): FillField => ({ id: f.field_id, name: f.field_name, type: f.type, options: f.property?.options?.map((o) => o.name) })

/** The table/sheet fields (for the target-field picker). */
export async function fetchFields(settings: AppSettings, source: FillSource): Promise<FillField[]> {
  const token = await resolveToken(settings)
  if (source.kind === 'base') {
    const fr = (await API.listFields(token, source.appToken, source.tableId)) as { items?: RawField[] }
    return (fr.items ?? []).map(mapBaseField)
  }
  // Sheet: the header row's non-empty cells become text fields, id = column letter.
  const res = (await readRange(token, source.spreadsheetToken, source.range)) as { valueRange?: { values?: unknown[][] } }
  const headers = (res.valueRange?.values?.[0] ?? []).map((v) => cellToString(v))
  return headers.map((h, i) => ({ id: colLetter(i + 1), name: h.trim(), type: 1 })).filter((f) => f.name)
}

/** The fillable subset, for the dropdown (Sheet columns are all text → all fillable). */
export async function fetchFillableFields(settings: AppSettings, source: FillSource): Promise<FillField[]> {
  return (await fetchFields(settings, source)).filter((f) => isFillable(f.type))
}

export interface FillContext {
  fields: FillField[]
  records: FillRecord[]
  capped: boolean
}

/** Full read: fields + all rows WITH their write keys preserved (record_id / row number). */
export async function fetchFillContext(settings: AppSettings, source: FillSource): Promise<FillContext> {
  const token = await resolveToken(settings)

  if (source.kind === 'base') {
    const fr = (await API.listFields(token, source.appToken, source.tableId)) as { items?: RawField[] }
    const fields = (fr.items ?? []).map(mapBaseField)
    const recs = await fetchAllRecords(token, source.appToken, source.tableId, READ_CAP)
    // Dedupe by record_id — a record must never be proposed (or written) twice.
    const seen = new Set<string>()
    const records: FillRecord[] = []
    for (const r of recs) {
      if (!r.record_id || seen.has(r.record_id)) continue
      seen.add(r.record_id)
      records.push({ recordId: r.record_id, fields: r.fields })
    }
    return { fields, records, capped: recs.length >= READ_CAP }
  }

  // Sheet: row 1 = headers, rows 2..N = data. The write key is the absolute row number.
  const res = (await readRange(token, source.spreadsheetToken, source.range)) as { valueRange?: { values?: unknown[][] } }
  const values = res.valueRange?.values ?? []
  const headers = (values[0] ?? []).map((v) => cellToString(v))
  const fields: FillField[] = headers.map((h, i) => ({ id: colLetter(i + 1), name: h.trim(), type: 1 })).filter((f) => f.name)
  const records: FillRecord[] = []
  for (let i = 1; i < values.length; i++) {
    const row = values[i]
    const f: Record<string, unknown> = {}
    headers.forEach((h, c) => { if (h.trim()) f[h.trim()] = row[c] })
    records.push({ recordId: String(i + 1), fields: f }) // sheet row number (row 1 = header)
  }
  return { fields, records, capped: values.length - 1 >= READ_CAP }
}
