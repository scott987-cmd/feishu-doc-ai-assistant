/**
 * Compound operations — capabilities Feishu has no native single API for,
 * built by chaining Base + Sheets calls. Verified live in harness/compose.test.ts.
 */
import * as API from './api'
import * as Sheets from './sheets'

interface Rec { record_id?: string; fields: Record<string, unknown> }

// Feishu batch endpoints (create/update/delete) accept at most 500 records per call.
const BATCH_SIZE = 500

function chunk<T>(arr: T[], size = BATCH_SIZE): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * Apply a write across batches, but DON'T throw on a mid-batch failure — Feishu
 * batches aren't a cross-batch transaction, so a later batch failing must NOT lose
 * the count of what already succeeded. Returns how many items were processed and,
 * on failure, the error + how many remain unprocessed (so the agent can tell the
 * user exactly where it stopped instead of pretending nothing happened).
 */
export async function applyInBatches<T>(
  items: T[],
  fn: (batch: T[]) => Promise<unknown>,
  size = BATCH_SIZE
): Promise<{ done: number; failed?: string; remaining: number }> {
  let done = 0
  for (const batch of chunk(items, size)) {
    try {
      await fn(batch)
      done += batch.length
    } catch (err) {
      return { done, failed: err instanceof Error ? err.message : String(err), remaining: items.length - done }
    }
  }
  return { done, remaining: 0 }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** A Base cell can be a primitive, an array of segments, or a rich object — flatten to text. */
export function cellToString(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(cellToString).join(', ')
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    return cellToString(o.text ?? o.name ?? o.value ?? JSON.stringify(o))
  }
  return String(v)
}

export function cellToNumber(v: unknown): number {
  const n = Number(cellToString(v).replace(/[,¥$%\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** Fetch all records of a table (paginated), capped to avoid runaway. */
export async function fetchAllRecords(
  token: string,
  appToken: string,
  tableId: string,
  cap = 1000
): Promise<Rec[]> {
  const out: Rec[] = []
  let pageToken: string | undefined
  do {
    const data = (await API.listRecords(token, appToken, tableId, 500, pageToken)) as {
      items?: Rec[]; page_token?: string; has_more?: boolean
    }
    out.push(...(data.items ?? []))
    pageToken = data.has_more ? data.page_token : undefined
  } while (pageToken && out.length < cap)
  return out.slice(0, cap)
}

/** Search all records matching a filter (paginated), capped to avoid runaway. */
export async function searchAllRecords(
  token: string,
  appToken: string,
  tableId: string,
  filter?: string,
  cap = 5000
): Promise<Rec[]> {
  const out: Rec[] = []
  let pageToken: string | undefined
  do {
    const data = (await API.searchRecords(token, appToken, tableId, filter, 500, undefined, pageToken)) as {
      items?: Rec[]; page_token?: string; has_more?: boolean
    }
    out.push(...(data.items ?? []))
    pageToken = data.has_more ? data.page_token : undefined
  } while (pageToken && out.length < cap)
  return out.slice(0, cap)
}

function colLetter(n: number): string {
  let s = ''
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s
  return s
}

async function newSheetWithGrid(token: string, title: string, grid: unknown[][]) {
  const created = (await Sheets.createSpreadsheet(token, title)) as {
    spreadsheet?: { spreadsheet_token?: string; url?: string }
  }
  const ss = created.spreadsheet!.spreadsheet_token!
  const sheets = (await Sheets.listSheets(token, ss)) as { sheets?: Array<{ sheet_id: string }> }
  const sid = sheets.sheets![0].sheet_id
  const rows = grid.length
  const cols = Math.max(1, ...grid.map((r) => r.length))
  await Sheets.writeRange(token, ss, `${sid}!A1:${colLetter(cols)}${rows}`, grid)
  return { spreadsheet_token: ss, url: created.spreadsheet?.url, sheet_id: sid, rows, cols }
}

// ─── Base table → Spreadsheet ───────────────────────────────────────────────

export async function tableToSheet(token: string, appToken: string, tableId: string, title?: string) {
  const fieldsRes = (await API.listFields(token, appToken, tableId)) as {
    items?: Array<{ field_name: string }>
  }
  const headers = (fieldsRes.items ?? []).map((f) => f.field_name)
  const records = await fetchAllRecords(token, appToken, tableId)
  const grid: unknown[][] = [headers, ...records.map((r) => headers.map((h) => cellToString(r.fields[h])))]
  const res = await newSheetWithGrid(token, title || '多维表格导出', grid)
  return { ...res, exported_rows: records.length }
}

// ─── Group-by aggregation (pivot Feishu's API lacks) ────────────────────────

export type AggOp = 'count' | 'sum' | 'avg' | 'max' | 'min'
export interface Metric { field: string; op: AggOp }

export async function summarizeTable(
  token: string,
  appToken: string,
  tableId: string,
  groupBy: string,
  metrics: Metric[],
  title?: string
) {
  const records = await fetchAllRecords(token, appToken, tableId)
  const groups = new Map<string, Rec[]>()
  for (const r of records) {
    const key = cellToString(r.fields[groupBy]) || '(空)'
    ;(groups.get(key) ?? groups.set(key, []).get(key)!).push(r)
  }

  const agg = (rows: Rec[], m: Metric): number => {
    if (m.op === 'count') return rows.length
    const nums = rows.map((r) => cellToNumber(r.fields[m.field]))
    if (m.op === 'sum') return nums.reduce((a, b) => a + b, 0)
    if (m.op === 'avg') return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0
    if (m.op === 'max') return nums.length ? Math.max(...nums) : 0
    if (m.op === 'min') return nums.length ? Math.min(...nums) : 0
    return 0
  }

  const header = [groupBy, ...metrics.map((m) => `${m.op}(${m.op === 'count' ? '记录' : m.field})`)]
  const grid: unknown[][] = [header]
  for (const [key, rows] of groups) {
    grid.push([key, ...metrics.map((m) => agg(rows, m))])
  }
  const res = await newSheetWithGrid(token, title || `汇总_按${groupBy}`, grid)
  return { ...res, groups: groups.size, source_records: records.length }
}

// ─── Dedupe records by key fields (Feishu has no native dedup) ───────────────

export interface DedupeResult {
  scanned: number
  capped: boolean
  key_fields: string[]
  keep: 'first' | 'last'
  dry_run: boolean
  duplicate_groups: number
  to_delete: number
  deleted: number
  sample: Array<{ key: string; total: number; deleting: number }>
}

export async function dedupeRecords(
  token: string,
  appToken: string,
  tableId: string,
  keyFields: string[],
  keep: 'first' | 'last' = 'first',
  dryRun = false
): Promise<DedupeResult> {
  const records = await fetchAllRecords(token, appToken, tableId, 5000)
  const groups = new Map<string, Rec[]>()
  for (const r of records) {
    // U+0001 is an unlikely-in-data separator so distinct field values can't collide.
    const key = keyFields.map((f) => cellToString(r.fields[f])).join(String.fromCharCode(1))
    ;(groups.get(key) ?? groups.set(key, []).get(key)!).push(r)
  }

  const toDelete: string[] = []
  const sample: DedupeResult['sample'] = []
  let duplicateGroups = 0
  for (const [key, rows] of groups) {
    if (rows.length <= 1) continue
    duplicateGroups++
    const losers = keep === 'last' ? rows.slice(0, -1) : rows.slice(1)
    for (const r of losers) if (r.record_id) toDelete.push(r.record_id)
    if (sample.length < 20) {
      sample.push({ key: key.split(String.fromCharCode(1)).join(" | "), total: rows.length, deleting: losers.length })
    }
  }

  let deleted = 0
  let partial: { failed?: string; remaining: number } = { remaining: 0 }
  if (!dryRun) {
    const r = await applyInBatches(toDelete, (ids) => API.batchDeleteRecords(token, appToken, tableId, ids))
    deleted = r.done
    partial = { failed: r.failed, remaining: r.remaining }
  }

  return {
    scanned: records.length,
    capped: records.length >= 5000,
    key_fields: keyFields,
    keep,
    dry_run: dryRun,
    duplicate_groups: duplicateGroups,
    to_delete: toDelete.length,
    deleted,
    ...(partial.failed ? { partial_failure: partial.failed, remaining_undeleted: partial.remaining } : {}),
    sample,
  }
}

// ─── Cross-table lookup / VLOOKUP (Feishu has no native cross-table match) ───

export interface CrossLookupResult {
  source_rows: number
  target_rows: number
  into_field: string
  created_field: boolean
  on_multiple: 'first' | 'join' | 'skip'
  filled: number
  unmatched: number
  multi_hit: number
  capped: boolean
}

export async function crossTableLookup(
  token: string,
  appToken: string,
  sourceTable: string,
  sourceKeyField: string,
  targetTable: string,
  targetKeyField: string,
  targetValueField: string,
  intoField: string,
  onMultiple: 'first' | 'join' | 'skip' = 'first',
  createIfMissing = true
): Promise<CrossLookupResult> {
  // Build a lookup index from the target table: key → [values...]
  const targetRecords = await fetchAllRecords(token, appToken, targetTable, 5000)
  const index = new Map<string, string[]>()
  for (const r of targetRecords) {
    const k = cellToString(r.fields[targetKeyField])
    if (k === '') continue
    ;(index.get(k) ?? index.set(k, []).get(k)!).push(cellToString(r.fields[targetValueField]))
  }

  // Ensure the destination column exists on the source table.
  const fieldsRes = (await API.listFields(token, appToken, sourceTable)) as {
    items?: Array<{ field_name: string }>
  }
  let createdField = false
  if (!(fieldsRes.items ?? []).some((f) => f.field_name === intoField)) {
    if (!createIfMissing) throw new Error(`目标列「${intoField}」不存在（create_field_if_missing=false）`)
    await API.createField(token, appToken, sourceTable, { field_name: intoField, type: API.FieldType.Text })
    createdField = true
  }

  const sourceRecords = await fetchAllRecords(token, appToken, sourceTable, 5000)
  const updates: Array<{ record_id: string; fields: Record<string, unknown> }> = []
  let unmatched = 0
  let multiHit = 0
  for (const r of sourceRecords) {
    if (!r.record_id) continue
    const hits = index.get(cellToString(r.fields[sourceKeyField])) ?? []
    if (hits.length === 0) {
      unmatched++
      continue
    }
    if (hits.length > 1) {
      multiHit++
      if (onMultiple === 'skip') continue
    }
    const value = hits.length > 1 && onMultiple === 'join' ? hits.join(', ') : hits[0]
    updates.push({ record_id: r.record_id, fields: { [intoField]: value } })
  }

  const w = await applyInBatches(updates, (batch) => API.batchUpdateRecords(token, appToken, sourceTable, batch))

  return {
    source_rows: sourceRecords.length,
    target_rows: targetRecords.length,
    into_field: intoField,
    created_field: createdField,
    on_multiple: onMultiple,
    filled: w.done,
    unmatched,
    multi_hit: multiHit,
    ...(w.failed ? { partial_failure: w.failed, remaining_unfilled: w.remaining } : {}),
    capped: sourceRecords.length >= 5000 || targetRecords.length >= 5000,
  }
}

// ─── Conditional bulk update (search → batch_update in one step) ─────────────

export interface UpdateWhereResult {
  matched: number
  updated: number
  set_fields: string[]
  dry_run: boolean
  capped: boolean
  sample?: Array<Record<string, string>>
}

export async function updateWhere(
  token: string,
  appToken: string,
  tableId: string,
  filter: string,
  set: Record<string, unknown>,
  dryRun = false
): Promise<UpdateWhereResult> {
  const matched = await searchAllRecords(token, appToken, tableId, filter, 5000)
  const capped = matched.length >= 5000

  if (dryRun) {
    const sample = matched.slice(0, 5).map((r) => {
      const preview: Record<string, string> = {}
      for (const k of Object.keys(r.fields).slice(0, 3)) preview[k] = cellToString(r.fields[k])
      return preview
    })
    return { matched: matched.length, updated: 0, set_fields: Object.keys(set), dry_run: true, capped, sample }
  }

  const updates = matched
    .filter((r): r is Rec & { record_id: string } => Boolean(r.record_id))
    .map((r) => ({ record_id: r.record_id, fields: set }))
  const w = await applyInBatches(updates, (batch) => API.batchUpdateRecords(token, appToken, tableId, batch))

  return {
    matched: matched.length,
    updated: w.done,
    set_fields: Object.keys(set),
    dry_run: false,
    capped,
    ...(w.failed ? { partial_failure: w.failed, remaining_unupdated: w.remaining } : {}),
  }
}

// ─── Data-quality audit (empty required / duplicates / numeric outliers) ─────

export interface AuditOptions {
  requiredFields?: string[]
  uniqueFields?: string[]
  numericFields?: string[]
}

export interface AuditReport {
  table_id: string
  scanned: number
  capped: boolean
  issues_total: number
  empty_required: Record<string, { count: number; sample: string[] }>
  duplicates: Record<string, Array<{ value: string; count: number }>>
  outliers: Record<string, {
    mean: number
    std: number
    count: number
    sample: Array<{ record_id: string; value: number }>
  }>
}

export async function auditTable(
  token: string,
  appToken: string,
  tableId: string,
  opts: AuditOptions = {}
): Promise<AuditReport> {
  const { requiredFields = [], uniqueFields = [], numericFields = [] } = opts
  const records = await fetchAllRecords(token, appToken, tableId, 5000)
  let issues = 0

  const empty_required: AuditReport['empty_required'] = {}
  for (const f of requiredFields) {
    const offenders = records.filter((r) => cellToString(r.fields[f]).trim() === '')
    if (offenders.length) {
      empty_required[f] = { count: offenders.length, sample: offenders.slice(0, 5).map((r) => r.record_id ?? '?') }
      issues += offenders.length
    }
  }

  const duplicates: AuditReport['duplicates'] = {}
  for (const f of uniqueFields) {
    const counts = new Map<string, number>()
    for (const r of records) {
      const v = cellToString(r.fields[f]).trim()
      if (v === '') continue
      counts.set(v, (counts.get(v) ?? 0) + 1)
    }
    const dups = [...counts.entries()].filter(([, c]) => c > 1).map(([value, count]) => ({ value, count }))
    if (dups.length) {
      duplicates[f] = dups.slice(0, 20)
      issues += dups.reduce((a, d) => a + (d.count - 1), 0)
    }
  }

  const outliers: AuditReport['outliers'] = {}
  for (const f of numericFields) {
    const vals = records
      .filter((r) => cellToString(r.fields[f]).trim() !== '')
      .map((r) => ({ r, n: cellToNumber(r.fields[f]) }))
    if (vals.length < 2) continue
    const nums = vals.map((v) => v.n)
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length
    const std = Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length)
    if (std === 0) continue
    const flagged = vals.filter((v) => Math.abs(v.n - mean) > 3 * std)
    if (flagged.length) {
      outliers[f] = {
        mean: round2(mean),
        std: round2(std),
        count: flagged.length,
        sample: flagged.slice(0, 5).map((v) => ({ record_id: v.r.record_id ?? '?', value: v.n })),
      }
      issues += flagged.length
    }
  }

  return {
    table_id: tableId,
    scanned: records.length,
    capped: records.length >= 5000,
    issues_total: issues,
    empty_required,
    duplicates,
    outliers,
  }
}
