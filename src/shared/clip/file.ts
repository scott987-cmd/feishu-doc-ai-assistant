import type { ClipCapture } from './types'
import { MAX_CLIP_CHARS } from './types'

/**
 * Drag-to-import: parse a dropped file CLIENT-SIDE into the same `ClipCapture` shape the
 * Web Clipper produces, so the existing target-selection + write flow handles it unchanged.
 *
 * MVP supports CSV / TSV / plain text (dependency-free). Excel (.xlsx) and PDF are NOT
 * supported on purpose — they'd require a large binary parser (SheetJS / pdf.js) and the
 * matching attack surface; users export "另存为 CSV" instead. Parsing is purely local; the
 * parsed text only leaves the machine via the existing LLM path (same trust boundary).
 */

/** RFC-4180-ish CSV/TSV parser: quoted fields, embedded delimiter/quote/newline, CRLF, BOM. */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const s = text.replace(/^﻿/, '') // strip UTF-8 BOM
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ } // escaped ""
        else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === delimiter) {
      row.push(field); field = ''
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = ''
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  // Drop blank lines (a single empty field).
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

/** Render rows as a Markdown table (mirrors capture.ts's toMd shape). Falls back to plain
 *  text for a single-column / header-less input so .txt still yields usable content. */
export function rowsToMarkdown(rows: string[][]): string {
  const clean = rows.map((r) => r.map((c) => c.trim().replace(/\s+/g, ' ').replace(/\|/g, '/')))
  const cols = Math.max(0, ...clean.map((r) => r.length))
  if (cols < 2 || clean.length < 1) return clean.map((r) => r.join(' ')).join('\n')
  const line = (r: string[]) => '| ' + Array.from({ length: cols }, (_, i) => r[i] ?? '').join(' | ') + ' |'
  return [line(clean[0]), '|' + ' --- |'.repeat(cols), ...clean.slice(1).map(line)].join('\n')
}

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result ?? ''))
    fr.onerror = () => reject(new Error('读取文件失败'))
    fr.readAsText(file)
  })
}

/** Parse a dropped file into a ClipCapture. Throws a friendly error for unsupported types. */
export async function fileToClip(file: File): Promise<ClipCapture> {
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('文件过大（超过 5MB）。请先在表格软件里筛选/拆分后再导入。')
  }
  const name = file.name
  const ext = name.toLowerCase().split('.').pop() || ''
  const isText = ext === 'csv' || ext === 'tsv' || ext === 'txt' || (file.type || '').startsWith('text/')
  if (!isText) {
    throw new Error('暂不支持该文件类型。请在 Excel/表格软件里「另存为 CSV」后再拖入。')
  }
  const text = await readText(file)
  let content: string
  if (ext === 'tsv') content = rowsToMarkdown(parseCsv(text, '\t'))
  else if (ext === 'csv' || file.type === 'text/csv') content = rowsToMarkdown(parseCsv(text, ','))
  else content = text // .txt / generic text/* — hand the raw text to the AI
  let truncated = false
  if (content.length > MAX_CLIP_CHARS) { content = content.slice(0, MAX_CLIP_CHARS); truncated = true }
  return { url: 'file://' + name, title: name, selectedText: '', content, capturedAt: Date.now(), truncated }
}
