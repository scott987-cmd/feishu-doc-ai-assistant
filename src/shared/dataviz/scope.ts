import type { VizSource } from './types'

/** Structural context (accepts both PageContext['feishu'] and parseFeishuContext()'s result). */
type Ctx = { kind?: string; appToken?: string; spreadsheetToken?: string; tableId?: string } | null | undefined

/**
 * "Document key" — a stable id for the Base app / Spreadsheet a viz belongs to. Used only as a
 * coarse "are we on the same document at all?" check; the actual side-panel / launcher filtering
 * is the per-table `vizMatchesCtx` below.
 */
export function vizDocKey(source: VizSource): string {
  return source.kind === 'base' ? 'base:' + source.appToken : 'sheet:' + source.spreadsheetToken
}

/** Doc key for the current page context — null when not on a Base/Spreadsheet. */
export function ctxDocKey(f: Ctx): string | null {
  if (f?.kind === 'base' && f.appToken) return 'base:' + f.appToken
  if (f?.kind === 'sheet' && f.spreadsheetToken) return 'sheet:' + f.spreadsheetToken
  return null
}

/**
 * Finer key matching `vizMatchesCtx`'s granularity (Base → per DATA-TABLE). Use this — not the
 * coarse `ctxDocKey` — for the in-memory "restore my last generation on THIS table" caches, so
 * switching tables within one Base doesn't restore/save another table's draft. Falls back to the
 * whole Base when the page URL carries no `?table=` (mirrors vizMatchesCtx's fallback).
 */
export function ctxScopeKey(f: Ctx): string | null {
  const doc = ctxDocKey(f)
  if (!doc) return null
  return f?.kind === 'base' && f.tableId ? doc + ':' + f.tableId : doc
}

/**
 * Does a saved viz/site belong to the table the user is currently looking at? This is the
 * scope filter for the side-panel list AND the on-page launcher pills.
 *
 * Base → per DATA-TABLE (appToken + tableId): a doc with many tables only shows each table's
 * own sites. When the page URL doesn't say which table (no `?table=`), fall back to the whole
 * Base app so nothing is silently hidden.
 * Sheet → per spreadsheet FILE (the page context carries no sheetId to go finer).
 */
export function vizMatchesCtx(source: VizSource, f: Ctx): boolean {
  if (source.kind === 'base') {
    return f?.kind === 'base' && f.appToken === source.appToken && (!f.tableId || f.tableId === source.tableId)
  }
  return source.kind === 'sheet' && f?.kind === 'sheet' && f.spreadsheetToken === source.spreadsheetToken
}
