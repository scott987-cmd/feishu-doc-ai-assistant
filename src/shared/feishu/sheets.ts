/**
 * Feishu Spreadsheet (电子表格) API wrapper.
 *
 * Mixes two API versions, as Feishu itself does:
 *   - sheets/v3 : spreadsheet + worksheet metadata
 *   - sheets/v2 : cell values (read/write/append) + worksheet batch ops
 *
 * `range` format is "{sheetId}!A1:C10" (or "{sheetId}!A:C" for whole columns).
 * Endpoints are verified live before being relied on (see harness/sheets.test.ts).
 */
import { feishuReq } from './http'

// ─── Spreadsheet ────────────────────────────────────────────────────────────

export function createSpreadsheet(token: string, title: string, folderToken?: string) {
  return feishuReq('POST', '/sheets/v3/spreadsheets', token, {
    title,
    ...(folderToken ? { folder_token: folderToken } : {}),
  })
}

export function getSpreadsheet(token: string, spreadsheetToken: string) {
  return feishuReq('GET', `/sheets/v3/spreadsheets/${spreadsheetToken}`, token)
}

// ─── Worksheets ───────────────────────────────────────────────────────────────

export function listSheets(token: string, spreadsheetToken: string) {
  return feishuReq('GET', `/sheets/v3/spreadsheets/${spreadsheetToken}/sheets/query`, token)
}

export function addSheet(token: string, spreadsheetToken: string, title: string, index?: number) {
  return feishuReq('POST', `/sheets/v2/spreadsheets/${spreadsheetToken}/sheets_batch_update`, token, {
    requests: [{ addSheet: { properties: { title, ...(index != null ? { index } : {}) } } }],
  })
}

export function deleteSheet(token: string, spreadsheetToken: string, sheetId: string) {
  return feishuReq('POST', `/sheets/v2/spreadsheets/${spreadsheetToken}/sheets_batch_update`, token, {
    requests: [{ deleteSheet: { sheetId } }],
  })
}

// ─── Cell values ──────────────────────────────────────────────────────────────

// Feishu stores a plain "=..." string as literal TEXT — it only evaluates a
// formula when the cell is written as { type: 'formula', text: '=...' } (verified
// live). So transparently convert "="-prefixed strings to formula cells; callers
// (and the LLM) can just write "=A2*B2" like Excel.
function normalizeCell(c: unknown): unknown {
  if (typeof c === 'string' && c.length > 1 && c.startsWith('=')) {
    return { type: 'formula', text: c }
  }
  return c
}
function normalizeValues(values: unknown[][]): unknown[][] {
  return values.map((row) => row.map(normalizeCell))
}

export function readRange(token: string, spreadsheetToken: string, range: string) {
  // valueRenderOption=FormattedValue → formula cells return their COMPUTED, display-
  // formatted value (default render & ToString return the formula expression like
  // "A2*B2"; FormattedValue gives 15 and also applies number/date formatting).
  return feishuReq(
    'GET',
    `/sheets/v2/spreadsheets/${spreadsheetToken}/values/${encodeURIComponent(range)}`,
    token,
    undefined,
    { valueRenderOption: 'FormattedValue' }
  )
}

export function writeRange(
  token: string,
  spreadsheetToken: string,
  range: string,
  values: unknown[][]
) {
  return feishuReq('PUT', `/sheets/v2/spreadsheets/${spreadsheetToken}/values`, token, {
    valueRange: { range, values: normalizeValues(values) },
  })
}

export function appendRows(
  token: string,
  spreadsheetToken: string,
  range: string,
  values: unknown[][]
) {
  return feishuReq('POST', `/sheets/v2/spreadsheets/${spreadsheetToken}/values_append`, token, {
    valueRange: { range, values: normalizeValues(values) },
  })
}

/** Fill a column with a per-row formula/value template ("{row}" → row number). */
export function fillColumn(
  token: string,
  spreadsheetToken: string,
  sheetId: string,
  column: string,
  startRow: number,
  endRow: number,
  template: string
) {
  const values: unknown[][] = []
  for (let r = startRow; r <= endRow; r++) values.push([template.replaceAll('{row}', String(r))])
  return writeRange(token, spreadsheetToken, `${sheetId}!${column}${startRow}:${column}${endRow}`, values)
}

// ─── Find / replace ───────────────────────────────────────────────────────────

export function findReplace(
  token: string,
  spreadsheetToken: string,
  sheetId: string,
  range: string,
  find: string,
  replacement: string
) {
  return feishuReq('POST', `/sheets/v3/spreadsheets/${spreadsheetToken}/sheets/${sheetId}/replace`, token, {
    find_condition: { range },
    find,
    replacement,
  })
}

// ─── Style / number format ──────────────────────────────────────────────────

/** Set a cell number format, e.g. "#,##0.00" / "0.00%" / "yyyy/mm/dd" / "¥#,##0". */
export function setNumberFormat(token: string, spreadsheetToken: string, range: string, formatter: string) {
  return feishuReq('PUT', `/sheets/v2/spreadsheets/${spreadsheetToken}/style`, token, {
    appendStyle: { range, style: { formatter } },
  })
}

// ─── Rows / columns (dimension) ───────────────────────────────────────────────

export function insertDimension(
  token: string,
  spreadsheetToken: string,
  sheetId: string,
  major: 'ROWS' | 'COLUMNS',
  startIndex: number,
  count: number
) {
  return feishuReq('POST', `/sheets/v2/spreadsheets/${spreadsheetToken}/insert_dimension_range`, token, {
    dimension: { sheetId, majorDimension: major, startIndex, endIndex: startIndex + count },
    inheritStyle: 'BEFORE',
  })
}

export function deleteDimension(
  token: string,
  spreadsheetToken: string,
  sheetId: string,
  major: 'ROWS' | 'COLUMNS',
  startIndex: number,
  count: number
) {
  return feishuReq('DELETE', `/sheets/v2/spreadsheets/${spreadsheetToken}/dimension_range`, token, {
    dimension: { sheetId, majorDimension: major, startIndex, endIndex: startIndex + count },
  })
}
