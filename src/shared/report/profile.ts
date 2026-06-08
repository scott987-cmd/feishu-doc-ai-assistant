import type { VizField } from '../dataviz/types'
import type { TableProfile, FieldProfile } from './types'

const SNIFF = 40 // values sampled to decide a field's kind
const TOPK = 5

/** Parse a cell to a number the way Base/Sheet values read (strip separators/currency). */
function toNum(s: string): number | null {
  const n = Number((s ?? '').replace(/[,，¥$%\s]/g, ''))
  return Number.isFinite(n) ? n : null
}
const round2 = (n: number) => Math.round(n * 100) / 100

function looksDate(s: string): boolean {
  const t = s.trim()
  if (!t) return false
  if (/^\d{13}$/.test(t)) return true                 // epoch ms
  if (/^\d{4}[-/.]\d{1,2}([-/.]\d{1,2})?/.test(t)) return true
  return /[年月日]/.test(t) && !Number.isNaN(Date.parse(t))
}

/**
 * Compact, privacy-light aggregates the LLM narrates from — schema-aware but VALUE-based,
 * because Sheets report every field type as 'Text' (so numeric/date are sniffed from values).
 * Pure (no I/O), unit-tested.
 */
export function profileTable(schema: VizField[], rows: Record<string, string>[]): TableProfile {
  const rowCount = rows.length
  const fields: FieldProfile[] = schema.map((f) => {
    const name = f.name
    const vals = rows.map((r) => (r[name] ?? '').trim())
    const nonEmpty = vals.filter((v) => v !== '')
    const fillRate = rowCount ? round2(nonEmpty.length / rowCount) : 0
    const sample = nonEmpty.slice(0, SNIFF)
    const typeHintsDate = /日期|时间|date|time/i.test(f.type)
    const numericShare = sample.length ? sample.map(toNum).filter((n) => n != null).length / sample.length : 0

    // Date — by Base type hint, or (for Sheets) by value shape when not numeric.
    if (typeHintsDate || (numericShare < 0.8 && sample.length > 0 && sample.filter(looksDate).length / sample.length >= 0.8)) {
      const sorted = [...nonEmpty].sort()
      return { name, type: f.type, fillRate, kind: 'date', minDate: sorted[0] ?? '', maxDate: sorted[sorted.length - 1] ?? '' }
    }
    // Numeric
    if (numericShare >= 0.8) {
      const all = nonEmpty.map(toNum).filter((n): n is number => n != null)
      const sum = all.reduce((a, b) => a + b, 0)
      return {
        name, type: f.type, fillRate, kind: 'numeric',
        count: all.length, sum: round2(sum), avg: all.length ? round2(sum / all.length) : 0,
        min: all.length ? Math.min(...all) : 0, max: all.length ? Math.max(...all) : 0,
      }
    }
    // Categorical
    const counts = new Map<string, number>()
    for (const v of nonEmpty) counts.set(v, (counts.get(v) ?? 0) + 1)
    const topValues = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOPK)
      .map(([value, count]) => ({ value: value.slice(0, 40), count }))
    return { name, type: f.type, fillRate, kind: 'category', distinct: counts.size, topValues }
  })
  return { rowCount, fieldCount: schema.length, fields }
}
