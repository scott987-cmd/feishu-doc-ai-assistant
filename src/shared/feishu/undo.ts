/**
 * Undo for record deletions — the "后悔药" for the scariest thing the assistant does to a table.
 * Before a delete runs we CAPTURE the rows' field data; after it succeeds we stash an undo entry.
 * A one-click "撤销" then RE-CREATES those rows (batch_create).
 *
 * Scope/limits (be honest): restores the field VALUES of deleted bitable records as NEW records
 * (record_ids change; computed/auto fields recompute; links by old id aren't restored). It does
 * NOT cover field/table/sheet deletions or doc-block deletions — those stay confirm-gated.
 */
import { storageGet, storageSet } from '../storage'
import * as API from './api'

const KEY = '_last_delete_undo_v1'
/** How long an undo stays offered (older entries are ignored — avoids a stale "撤销" much later). */
export const UNDO_TTL_MS = 10 * 60 * 1000

export interface DeleteUndo {
  at: number
  appToken: string
  tableId: string
  label: string
  records: Array<{ fields: Record<string, unknown> }>
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

export async function saveDeleteUndo(u: Omit<DeleteUndo, 'at'>): Promise<void> {
  if (!u.records.length) return // nothing captured → no undo to offer
  await storageSet(KEY, { ...u, at: Date.now() })
}

export async function loadDeleteUndo(): Promise<DeleteUndo | null> {
  const v = await storageGet(KEY)
  if (v && typeof v === 'object' && Array.isArray((v as DeleteUndo).records) && (v as DeleteUndo).records.length) {
    const u = v as DeleteUndo
    if (Date.now() - u.at <= UNDO_TTL_MS) return u
  }
  return null
}

export async function clearDeleteUndo(): Promise<void> { await storageSet(KEY, null) }

/** Re-create the deleted records. Returns how many were restored. */
export async function restoreDeleteUndo(token: string, u: DeleteUndo): Promise<number> {
  if (!u.records.length) return 0
  await API.batchCreateRecords(token, u.appToken, u.tableId, u.records)
  return u.records.length
}
