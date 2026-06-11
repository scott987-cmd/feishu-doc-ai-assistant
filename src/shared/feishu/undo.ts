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

// Feishu field types that are COMPUTED / AUTO and rejected by records/batch_create. Capturing
// them would make the whole undo's re-create FAIL, so they're stripped: 19 Lookup · 20 Formula ·
// 1001 CreatedTime · 1002 ModifiedTime · 1003 CreatedUser · 1004 ModifiedUser · 1005 AutoNumber.
const READONLY_FIELD_TYPES = new Set([19, 20, 1001, 1002, 1003, 1004, 1005])

/** Capture the WRITABLE field data of specific records right before deleting them (read-only
 *  computed/auto fields are stripped so the restore's batch_create isn't rejected). Never throws —
 *  a capture failure must not block the delete; it just means no undo is offered. */
export async function captureRecords(
  token: string, appToken: string, tableId: string, recordIds: string[],
): Promise<Array<{ fields: Record<string, unknown> }>> {
  if (!recordIds?.length) return []
  try {
    const [recRes, fieldRes] = await Promise.all([
      API.batchGetRecords(token, appToken, tableId, recordIds) as Promise<{ records?: Array<{ fields?: Record<string, unknown> }> }>,
      (API.listFields(token, appToken, tableId) as Promise<{ items?: Array<{ field_name?: string; type?: number }> }>).catch(() => null),
    ])
    // Set of writable field names; if field meta can't be read, keep everything (best-effort).
    const writable = fieldRes?.items
      ? new Set(fieldRes.items.filter((f) => f.type == null || !READONLY_FIELD_TYPES.has(f.type)).map((f) => f.field_name))
      : null
    return (recRes.records ?? []).map((x) => {
      const all = x.fields ?? {}
      const fields = writable ? Object.fromEntries(Object.entries(all).filter(([k]) => writable.has(k))) : all
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
