/**
 * Undo for deletions — the "后悔药". Before a delete runs we CAPTURE the data; after it succeeds we
 * stash ONE undo entry; a one-click "撤销" re-creates it. Two kinds (one shared bar/storage):
 *   • records  — bitable records → batch_create (record_ids change; computed/auto fields recompute)
 *   • sheetRows — spreadsheet ROW deletes → insert the rows back + write the captured values
 * Field/table/sheet-FILE deletions and doc-block deletions are NOT covered (doc edits are
 * recoverable via Feishu's 版本历史; we tell the user that instead).
 */
import { storageGet, storageSet } from '../storage'
import * as API from './api'
import * as Sheets from './sheets'

const KEY = '_last_delete_undo_v1'
/** How long an undo stays offered (older entries are ignored — avoids a stale "撤销" much later). */
export const UNDO_TTL_MS = 10 * 60 * 1000
/** Cap how many sheet rows we capture — a huge delete shouldn't bloat storage / a slow restore. */
const SHEET_ROW_CAP = 200

export interface RecordsUndo {
  kind?: 'records' // optional → back-compat with entries stored before sheetRows existed
  at: number
  label: string
  appToken: string
  tableId: string
  records: Array<{ fields: Record<string, unknown> }>
}
export interface SheetRowsUndo {
  kind: 'sheetRows'
  at: number
  label: string
  spreadsheetToken: string
  sheetId: string
  startIndex: number // 0-based row index where the deleted rows began
  values: unknown[][]
}
export type DeleteUndo = RecordsUndo | SheetRowsUndo
// Plain Omit<union, K> collapses to the COMMON keys only; distribute it so member-specific
// fields (appToken/records vs spreadsheetToken/values) survive.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type NewUndo = DistributiveOmit<DeleteUndo, 'at'>

/** A1 column letter for a 1-based column count (1→A, 27→AA). */
function colLetter(n: number): string {
  let s = ''
  for (let x = Math.max(1, n); x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s
  return s
}

/**
 * Convert a field's batch_get READ value into the batch_create WRITE format, or return `undefined`
 * to DROP the field (read-only, or a complex type whose write format we can't reconstruct). Without
 * this the restore's batch_create was rejected (the READ shape ≠ WRITE shape for user/attachment/
 * link fields), which made "↩ 撤销" silently fail. Simple types (text/number/select/date/checkbox/
 * phone/url/…) round-trip unchanged.
 */
/** Flatten a Feishu rich-text READ value to a plain string. Text fields come back from batch_get
 *  as a segment array [{type:'text', text:'…'}] (or a {text} object), but batch_create expects a
 *  plain string → otherwise it fails with code 1254060 TextFieldConvFail. */
function richTextToString(v: unknown): unknown {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map((s) => (typeof s === 'string' ? s : String((s as { text?: unknown })?.text ?? ''))).join('')
  if (v && typeof v === 'object' && 'text' in v) return String((v as { text?: unknown }).text ?? '')
  return v
}

function toWriteValue(type: number | undefined, v: unknown): unknown {
  if (v == null) return undefined
  switch (type) {
    case 19: case 20: case 1001: case 1002: case 1003: case 1004: case 1005:
      return undefined // computed/auto — never writable
    case 1: case 13: case 15: // Text / Phone / URL — read may be a rich-text array → plain string
      return richTextToString(v)
    case 11: // User: read [{id,name,…}] → write [{id}]
      return Array.isArray(v) ? v.map((u) => ({ id: (u as { id?: string })?.id })).filter((u) => u.id) : undefined
    case 17: // Attachment: read [{file_token,name,…}] → write [{file_token}]
      return Array.isArray(v) ? v.map((a) => ({ file_token: (a as { file_token?: string })?.file_token })).filter((a) => a.file_token) : undefined
    case 18: case 21: case 22: case 23: // Link / Location / GroupChat — write format uncertain → drop (partial restore)
      return undefined
    default:
      // Other types (number / single+multi select / date / checkbox / rating / …) round-trip, BUT a
      // value that arrived as a rich-text segment array must still be flattened or it fails as text.
      return Array.isArray(v) && v.length && typeof v[0] === 'object' && v[0] !== null && 'text' in (v[0] as object)
        ? richTextToString(v)
        : v
  }
}

/** Capture restorable field data of specific records right before deleting them — values are
 *  converted to batch_create WRITE format (read-only & uncertain-complex fields dropped) so the
 *  restore actually succeeds. Never throws — a capture failure must not block the delete. */
export async function captureRecords(
  token: string, appToken: string, tableId: string, recordIds: string[],
): Promise<Array<{ fields: Record<string, unknown> }>> {
  if (!recordIds?.length) return []
  try {
    const [recRes, fieldRes] = await Promise.all([
      API.batchGetRecords(token, appToken, tableId, recordIds) as Promise<{ records?: Array<{ fields?: Record<string, unknown> }> }>,
      (API.listFields(token, appToken, tableId) as Promise<{ items?: Array<{ field_name?: string; type?: number }> }>).catch(() => null),
    ])
    const typeByName = new Map((fieldRes?.items ?? []).map((f) => [f.field_name, f.type]))
    const hasMeta = !!fieldRes?.items
    return (recRes.records ?? []).map((x) => {
      const all = x.fields ?? {}
      const fields: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(all)) {
        const wv = hasMeta ? toWriteValue(typeByName.get(k), v) : v
        if (wv != null && !(Array.isArray(wv) && wv.length === 0)) fields[k] = wv
      }
      return { fields }
    })
  } catch { return [] }
}

/** Capture the VALUES of spreadsheet rows about to be deleted, so the delete can be undone
 *  (re-insert the rows + write the values back). ROWS only; never throws (no undo on failure). */
export async function captureSheetRows(
  token: string, spreadsheetToken: string, sheetId: string, startIndex: number, count: number,
): Promise<Omit<SheetRowsUndo, 'at'> | null> {
  if (!sheetId || count <= 0 || count > SHEET_ROW_CAP) return null
  try {
    const meta = (await Sheets.listSheets(token, spreadsheetToken)) as { sheets?: Array<{ sheet_id?: string; grid_properties?: { column_count?: number } }> }
    const cols = Math.min(Math.max(1, meta.sheets?.find((s) => s.sheet_id === sheetId)?.grid_properties?.column_count ?? 26), 200)
    const range = `${sheetId}!A${startIndex + 1}:${colLetter(cols)}${startIndex + count}`
    const res = (await Sheets.readRange(token, spreadsheetToken, range)) as { valueRange?: { values?: unknown[][] } }
    const values = res.valueRange?.values ?? []
    if (!values.length) return null
    return { kind: 'sheetRows', label: `删除 ${count} 行`, spreadsheetToken, sheetId, startIndex, values }
  } catch { return null }
}

export async function saveDeleteUndo(u: NewUndo): Promise<void> {
  const empty = u.kind === 'sheetRows' ? !u.values.length : !u.records.length
  if (empty) return // nothing captured → no undo to offer
  await storageSet(KEY, { ...u, at: Date.now() })
}

export async function loadDeleteUndo(): Promise<DeleteUndo | null> {
  const v = await storageGet(KEY)
  if (!v || typeof v !== 'object') return null
  const u = v as DeleteUndo
  if (Date.now() - u.at > UNDO_TTL_MS) return null
  if (u.kind === 'sheetRows') return Array.isArray(u.values) && u.values.length ? u : null
  return Array.isArray(u.records) && u.records.length ? u : null
}

export async function clearDeleteUndo(): Promise<void> { await storageSet(KEY, null) }

/** Re-create what was deleted. Returns how many records/rows were restored. */
export async function restoreDeleteUndo(token: string, u: DeleteUndo): Promise<number> {
  if (u.kind === 'sheetRows') {
    if (!u.values.length) return 0
    await Sheets.insertDimension(token, u.spreadsheetToken, u.sheetId, 'ROWS', u.startIndex, u.values.length)
    const range = `${u.sheetId}!A${u.startIndex + 1}:${colLetter(Math.max(1, ...u.values.map((r) => r.length)))}${u.startIndex + u.values.length}`
    await Sheets.writeRange(token, u.spreadsheetToken, range, u.values)
    return u.values.length
  }
  if (!u.records.length) return 0
  await API.batchCreateRecords(token, u.appToken, u.tableId, u.records)
  return u.records.length
}
