/**
 * Data-viz / "data app": the AI generates a render(data, echarts, chart) code template once;
 * the data is re-fetched LIVE on every open. So a saved viz is a live dashboard that costs
 * nothing (no LLM) to re-open and always shows current table data.
 */

export type VizSource =
  | { kind: 'base'; appToken: string; tableId: string }
  | { kind: 'sheet'; spreadsheetToken: string; range: string }

/** A field's name + type, plus a few real sample values so the model knows the actual
 *  format (date layout, currency style, option labels) instead of guessing from the name. */
export interface VizField { name: string; type: string; samples?: string[] }
export interface VizData { schema: VizField[]; rows: Record<string, string>[] }
/** One sub-table of a doc (a Base data-table or a Spreadsheet worksheet), named so a generated
 *  site can link several together. The primary (current) sub-table is conventionally index 0. */
export interface VizDataset { name: string; schema: VizField[]; rows: Record<string, string>[] }

export interface SavedViz {
  id: string
  name: string
  source: VizSource
  /** Body of render(data, echarts, chart, container) — the saved artifact (no data inside). */
  code: string
  createdAt: number
  /** 'viz' = chart/小程序 (default when absent), 'site' = AI 建站 full page. Cosmetic only
   *  (icon/label); both reuse the same render/save/launcher/open-with-fresh-data path. */
  kind?: 'viz' | 'site'
  /** Site built across MULTIPLE sub-tables of the doc → re-fetch ALL of them (not just
   *  `source`) on open, and hand them to the render as the `datasets` map. */
  multi?: boolean
}
