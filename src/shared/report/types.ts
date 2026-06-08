// Data-to-Narrative-Report: read the current Base/Sheet → compact local aggregates →
// LLM writes a markdown analysis → new doc + the source data appended as a table.

export type FieldProfile =
  | { name: string; type: string; fillRate: number; kind: 'numeric'; count: number; sum: number; avg: number; min: number; max: number }
  | { name: string; type: string; fillRate: number; kind: 'date'; minDate: string; maxDate: string }
  | { name: string; type: string; fillRate: number; kind: 'category'; distinct: number; topValues: Array<{ value: string; count: number }> }

export interface TableProfile {
  rowCount: number
  fieldCount: number
  fields: FieldProfile[]
}

export interface ReportResult {
  documentId: string
  url: string
  title: string
  rowsShown: number
  colsShown: number
  rowCount: number
  tableAppended: boolean
}
