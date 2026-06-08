import { describe, it, expect } from 'vitest'
import { coerceValue, isFillable } from './coerce'
import type { FillField } from './types'

const f = (type: number, options?: string[]): FillField => ({ id: 'x', name: 'F', type, options })

describe('isFillable', () => {
  it('allows simple inferable types, excludes formula/lookup/relation/system/attachment/person', () => {
    for (const t of [1, 2, 3, 4, 5, 7, 13, 15]) expect(isFillable(t)).toBe(true)
    for (const t of [11, 17, 18, 19, 20, 21, 22, 1001, 1005]) expect(isFillable(t)).toBe(false)
  })
})

describe('coerceValue', () => {
  it('text/phone/url → trimmed string, empty rejected', () => {
    expect(coerceValue(f(1), '  hi ')).toEqual({ ok: true, value: 'hi', display: 'hi' })
    expect(coerceValue(f(15), 'https://x')).toMatchObject({ ok: true, value: 'https://x' })
    expect(coerceValue(f(1), '')).toMatchObject({ ok: false })
  })

  it('number → parsed, strips separators/currency, rejects non-numeric', () => {
    expect(coerceValue(f(2), '1,234')).toEqual({ ok: true, value: 1234, display: '1234' })
    expect(coerceValue(f(2), '¥99.5')).toMatchObject({ ok: true, value: 99.5 })
    expect(coerceValue(f(2), '一百')).toMatchObject({ ok: false })
  })

  it('single-select must be an existing option (never invents)', () => {
    const fld = f(3, ['互联网', '金融'])
    expect(coerceValue(fld, '互联网')).toMatchObject({ ok: true, value: '互联网' })
    expect(coerceValue(fld, '教育')).toMatchObject({ ok: false })
  })

  it('multi-select keeps only valid options, from an array or a delimited string', () => {
    const fld = f(4, ['A', 'B', 'C'])
    expect(coerceValue(fld, ['A', 'Z', 'C'])).toMatchObject({ ok: true, value: ['A', 'C'] })
    expect(coerceValue(fld, 'A、B/Z')).toMatchObject({ ok: true, value: ['A', 'B'] })
    expect(coerceValue(fld, 'Z')).toMatchObject({ ok: false })
  })

  it('date → epoch ms (tz-stable for ISO date), rejects garbage', () => {
    const r = coerceValue(f(5), '2024-06-01')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe(Date.parse('2024-06-01'))
    expect(coerceValue(f(5), '不是日期')).toMatchObject({ ok: false })
  })

  it('checkbox → boolean', () => {
    expect(coerceValue(f(7), '是')).toMatchObject({ ok: true, value: true })
    expect(coerceValue(f(7), 'no')).toMatchObject({ ok: true, value: false })
  })
})
