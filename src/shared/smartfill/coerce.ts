import type { FillField } from './types'

// Field types Smart Fill can safely infer + write. Everything else — formula(20),
// lookup(19), auto-number(1005), relations(18/21), attachment(17), person(11),
// location(22), and system stamps(1001-1004) — is excluded from the target picker
// because the model can't produce a safe value for them.
const FILLABLE = new Set([1, 2, 3, 4, 5, 7, 13, 15])

export function isFillable(type: number): boolean {
  return FILLABLE.has(type)
}

/** Short Chinese label per fillable type (for prompts / UI). */
export const TYPE_LABEL: Record<number, string> = {
  1: '文本', 2: '数字', 3: '单选', 4: '多选', 5: '日期', 7: '勾选', 13: '电话', 15: '链接',
}

export type CoerceOutcome =
  | { ok: true; value: unknown; display: string }
  | { ok: false; reason: string }

function toEpochMs(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Heuristic: treat large ints as epoch ms, ~10-digit as epoch seconds.
    if (raw > 1e12) return raw
    if (raw > 1e9) return raw * 1000
    return null
  }
  const t = Date.parse(String(raw).trim())
  return Number.isNaN(t) ? null : t
}

function fmtDate(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * Coerce a raw model value to the field's native write type, or reject it with a
 * reason. This is the safety core: selects MUST match an existing option (never
 * invents one); numbers/dates must parse. A rejected value becomes a visible
 * "skipped" row in the preview rather than a bad write.
 */
export function coerceValue(field: FillField, raw: unknown): CoerceOutcome {
  if (raw == null || raw === '') return { ok: false, reason: '空值' }

  switch (field.type) {
    case 1: case 13: case 15: { // Text / Phone / URL
      const s = String(raw).trim()
      return s ? { ok: true, value: s, display: s } : { ok: false, reason: '空值' }
    }
    case 2: { // Number
      const n = Number(String(raw).replace(/[,，¥$%\s]/g, ''))
      return Number.isFinite(n) ? { ok: true, value: n, display: String(n) } : { ok: false, reason: `不是数字：${String(raw).slice(0, 20)}` }
    }
    case 3: { // SingleSelect — must be an existing option
      const s = String(raw).trim()
      if (!field.options?.includes(s)) return { ok: false, reason: `不在选项内：${s.slice(0, 20)}` }
      return { ok: true, value: s, display: s }
    }
    case 4: { // MultiSelect — array of existing options
      const arr = Array.isArray(raw)
        ? raw.map((x) => String(x).trim())
        : String(raw).split(/[,，/、|]/).map((s) => s.trim()).filter(Boolean)
      const valid = arr.filter((s) => field.options?.includes(s))
      if (!valid.length) return { ok: false, reason: `无匹配选项：${arr.join('/').slice(0, 30)}` }
      return { ok: true, value: valid, display: valid.join(' / ') }
    }
    case 5: { // DateTime — write epoch milliseconds
      const ms = toEpochMs(raw)
      return ms == null ? { ok: false, reason: `无法识别日期：${String(raw).slice(0, 20)}` } : { ok: true, value: ms, display: fmtDate(ms) }
    }
    case 7: { // Checkbox
      const b = /^(true|是|对|✓|y|yes|1|on)$/i.test(String(raw).trim())
      return { ok: true, value: b, display: b ? '✓ 是' : '— 否' }
    }
    default:
      return { ok: false, reason: `不支持的字段类型 ${field.type}` }
  }
}
