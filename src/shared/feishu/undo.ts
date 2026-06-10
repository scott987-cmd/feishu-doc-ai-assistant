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

/** Capture the field data of specific records right before deleting them. Never throws — a
 *  capture failure must not block the delete; it just means no undo is offered. */
export async function captureRecords(
  token: string, appToken: string, tableId: string, recordIds: string[],
): Promise<Array<{ fields: Record<string, unknown> }>> {
  if (!recordIds?.length) return []
  try {
    const r = (await API.batchGetRecords(token, appToken, tableId, recordIds)) as { records?: Array<{ fields?: Record<string, unknown> }> }
    return (r.records ?? []).map((x) => ({ fields: x.fields ?? {} })).filter((x) => Object.keys(x.fields).length)
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
