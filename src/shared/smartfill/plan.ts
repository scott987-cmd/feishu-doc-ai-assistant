import type { AppSettings } from '../types'
import { resolveToken } from '../feishu/auth'
import * as API from '../feishu/api'
import { readRange, writeRange } from '../feishu/sheets'
import { cellToString } from '../feishu/compose'
import { fetchFillContext } from './data'
import { inferFills, type InferRow } from '../ai/smartfill'
import { isFillable, coerceValue } from './coerce'
import type { FillField, FillPlan, FillRecord, FillRequest, FillSource, ProposedFill, SkippedFill, ApplyResult } from './types'

const INFER_BATCH = 40    // empty rows per LLM call (context-bound)
const EXAMPLE_CAP = 8     // few-shot filled rows shown to the model
const SOURCE_COL_CAP = 12 // max source columns sent (wide tables)
const CELL_CAP = 200      // truncate long cell values
const PREVIEW_CAP = 300   // rows inferred per preview run (re-run after apply for the rest)
const WRITE_BATCH = 500   // Feishu records/batch_update limit

function isEmpty(rec: FillRecord, name: string): boolean {
  return cellToString(rec.fields[name]).trim() === ''
}

function rowLabel(rec: FillRecord, sourceFields: string[]): string {
  for (const s of sourceFields) {
    const v = cellToString(rec.fields[s]).trim()
    if (v) return v.slice(0, 40)
  }
  return rec.recordId
}

/**
 * Read the table, infer the target column for eligible rows in batches, coerce + validate
 * each value, and assemble a preview. NOTHING is written here. Each row carries a stable
 * `key`; the model echoes it, so a value always maps to the right record id regardless of
 * the model's output order.
 */
export async function buildPlan(
  settings: AppSettings,
  source: FillSource,
  req: FillRequest,
): Promise<FillPlan> {
  const { fields, records, capped } = await fetchFillContext(settings, source)
  const field: FillField | undefined = fields.find((f) => f.name === req.targetField)
  if (!field) throw new Error(`找不到字段「${req.targetField}」。`)
  if (!isFillable(field.type)) throw new Error('该字段类型不支持智能填充（公式 / 查找 / 自动编号等由系统维护）。')

  const eligible = req.overwrite ? records : records.filter((r) => isEmpty(r, field.name))
  const filled = records.filter((r) => !isEmpty(r, field.name))
  const targets = eligible.slice(0, PREVIEW_CAP)

  const allSource = fields.filter((f) => f.name !== field.name).map((f) => f.name)
  const sourceFields = (req.sourceFields?.length ? req.sourceFields : allSource).slice(0, SOURCE_COL_CAP)

  const rowCells = (rec: FillRecord): Record<string, string> => {
    const o: Record<string, string> = {}
    for (const s of sourceFields) o[s] = cellToString(rec.fields[s]).slice(0, CELL_CAP)
    return o
  }
  const examples = filled.slice(0, EXAMPLE_CAP).map((r) => ({ ...rowCells(r), [field.name]: cellToString(r.fields[field.name]) }))

  const proposed: ProposedFill[] = []
  const skipped: SkippedFill[] = []

  for (let i = 0; i < targets.length; i += INFER_BATCH) {
    const batch = targets.slice(i, i + INFER_BATCH)
    const rows: InferRow[] = []
    const keyRec: Array<{ key: string; rec: FillRecord }> = []
    batch.forEach((rec, j) => {
      const key = `r${i + j}`
      rows.push({ key, cells: rowCells(rec) })
      keyRec.push({ key, rec })
    })
    const result = await inferFills(settings, { field, sourceFields, examples, rows, instruction: req.instruction })
    for (const { key, rec } of keyRec) {
      const label = rowLabel(rec, sourceFields)
      if (!result.has(key)) { skipped.push({ rowLabel: label, reason: '模型未填充（不确定）' }); continue }
      const outcome = coerceValue(field, result.get(key))
      if (!outcome.ok) { skipped.push({ rowLabel: label, reason: outcome.reason }); continue }
      proposed.push({ recordId: rec.recordId, rowLabel: label, value: outcome.value, display: outcome.display })
    }
  }

  return {
    source,
    field,
    totalRows: records.length,
    eligibleRows: eligible.length,
    consideredRows: targets.length,
    morePending: eligible.length > targets.length,
    examples: examples.length,
    overwrite: req.overwrite,
    capped,
    proposed,
    skipped,
  }
}

/**
 * Apply the previewed fills: update-only, as the user, batched with partial-failure
 * reporting (mirrors compose's updateWhere). The field name comes from the trusted plan,
 * the values from the (already coerced) proposed list — nothing from the model is written raw.
 */
export async function applyPlan(settings: AppSettings, plan: FillPlan): Promise<ApplyResult> {
  const token = await resolveToken(settings)
  return plan.source.kind === 'base'
    ? applyBase(token, plan, plan.source)
    : applySheet(token, plan, plan.source)
}

async function applyBase(token: string, plan: FillPlan, source: { appToken: string; tableId: string }): Promise<ApplyResult> {
  // One update per record id (last value wins) — never send a duplicate id within a batch.
  const byId = new Map<string, unknown>()
  for (const p of plan.proposed) byId.set(p.recordId, p.value)
  const updates = [...byId].map(([record_id, value]) => ({ record_id, fields: { [plan.field.name]: value } }))
  const total = updates.length
  if (!total) return { done: 0, total: 0, remaining: 0 }

  let done = 0
  for (let i = 0; i < updates.length; i += WRITE_BATCH) {
    const batch = updates.slice(i, i + WRITE_BATCH)
    try {
      const res = (await API.batchUpdateRecords(token, source.appToken, source.tableId, batch)) as { records?: unknown[] }
      // Count what Feishu ACTUALLY acknowledged: it can return success (code 0) while applying
      // only a subset, listing just those in data.records. Trusting batch.length is what made
      // the panel report 125 when only 80 landed.
      done += Array.isArray(res?.records) ? res.records.length : batch.length
    } catch (e) {
      return { done, total, failed: e instanceof Error ? e.message : String(e), remaining: total - done }
    }
  }
  return { done, total, remaining: total - done }
}

async function applySheet(token: string, plan: FillPlan, source: { spreadsheetToken: string; sheetId: string }): Promise<ApplyResult> {
  const col = plan.field.id // for sheets, the field id IS the column letter
  // proposed.recordId is the absolute row number → value.
  const byRow = new Map<number, unknown>()
  for (const p of plan.proposed) byRow.set(Number(p.recordId), p.value)
  const total = byRow.size
  if (!total) return { done: 0, total: 0, remaining: 0 }

  const rows = [...byRow.keys()]
  const minR = Math.min(...rows), maxR = Math.max(...rows)
  const range = `${source.sheetId}!${col}${minR}:${col}${maxR}`
  try {
    // Re-read the column span so we only fill cells that are STILL empty (don't clobber
    // anything edited since preview) and write everything else back unchanged. One write.
    const cur = (await readRange(token, source.spreadsheetToken, range)) as { valueRange?: { values?: unknown[][] } }
    const curVals = cur.valueRange?.values ?? []
    const out: unknown[][] = []
    let done = 0
    for (let r = minR; r <= maxR; r++) {
      const existing = curVals[r - minR]?.[0]
      if (byRow.has(r) && cellToString(existing).trim() === '') { out.push([byRow.get(r)]); done++ }
      else out.push([existing ?? '']) // keep non-target / already-filled cells unchanged
    }
    if (!done) return { done: 0, total, remaining: total }
    await writeRange(token, source.spreadsheetToken, range, out)
    return { done, total, remaining: total - done }
  } catch (e) {
    return { done: 0, total, failed: e instanceof Error ? e.message : String(e), remaining: total }
  }
}
