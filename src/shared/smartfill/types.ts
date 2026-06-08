// Smart Fill — infer a target column's missing values from the row's other columns
// (+ already-filled cells as examples), preview, then write back as the user.
// Returns STRUCTURED values (not code), so it's entirely side-panel-local — no sandbox.

/** Where Smart Fill reads from and writes to — a Base table or a Spreadsheet worksheet. */
export type FillSource =
  | { kind: 'base'; appToken: string; tableId: string }
  | { kind: 'sheet'; spreadsheetToken: string; sheetId: string; range: string }

/**
 * A field as Smart Fill sees it. For a Base, `id` is the field_id and `type`/`options`
 * come from the schema. For a Sheet, `id` is the COLUMN LETTER (e.g. "C") and everything
 * is free text (`type: 1`, no options).
 */
export interface FillField {
  id: string
  name: string
  type: number        // Feishu field type number (see FieldType); 1 (Text) for all Sheet columns
  options?: string[]  // option names for SingleSelect(3) / MultiSelect(4)
}

/**
 * One row read from the source; raw `fields` is preserved. `recordId` is the opaque
 * write key — a Base record_id, or a Sheet row number (as a string).
 */
export interface FillRecord {
  recordId: string
  fields: Record<string, unknown>
}

/** A coerced, ready-to-write fill for one row. */
export interface ProposedFill {
  recordId: string
  rowLabel: string  // human-readable row identifier for the preview (a source cell)
  value: unknown    // typed value to write (number / string / string[] / boolean / epoch-ms)
  display: string   // string form shown in the preview table
}

/** A row the model returned (or didn't) that we couldn't safely use. */
export interface SkippedFill {
  rowLabel: string
  reason: string
}

/** The full preview model — assembled WITHOUT writing anything. */
export interface FillPlan {
  source: FillSource
  field: FillField
  totalRows: number      // all records in the table
  eligibleRows: number   // empty (or all, when overwrite) rows before the per-run cap
  consideredRows: number // how many we actually ran inference on this round
  morePending: boolean   // eligibleRows > consideredRows (re-run after apply for the rest)
  examples: number       // few-shot examples used
  overwrite: boolean
  capped: boolean        // table read hit the record cap
  proposed: ProposedFill[]
  skipped: SkippedFill[]
}

/** What the panel asks for. */
export interface FillRequest {
  targetField: string      // field name to fill
  instruction: string      // optional natural-language hint
  sourceFields?: string[]  // optional explicit columns to reason from (default: all others)
  overwrite: boolean       // also fill non-empty cells?
}

export interface ApplyResult {
  done: number
  total: number
  failed?: string
  remaining: number
}
