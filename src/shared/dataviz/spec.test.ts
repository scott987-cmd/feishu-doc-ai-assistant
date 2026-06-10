import { describe, it, expect } from 'vitest'
import { validateSpec } from './spec'

const FIELDS = ['区域', '金额', '状态']

describe('validateSpec', () => {
  it('throws on missing/invalid kind', () => {
    expect(() => validateSpec({}, FIELDS)).toThrow()
    expect(() => validateSpec(null, FIELDS)).toThrow()
  })

  it('passes a valid chart spec and defaults chartType to bar', () => {
    const s = validateSpec({ kind: 'chart', chartType: 'nonsense', series: { dimension: '区域' } }, FIELDS)
    expect(s.kind).toBe('chart')
    expect((s as any).chartType).toBe('bar')
  })

  it('rejects a chart whose dimension is not a real field', () => {
    expect(() => validateSpec({ kind: 'chart', chartType: 'bar', series: { dimension: '不存在' } }, FIELDS)).toThrow()
  })

  it('clamps series.limit and pageSize', () => {
    const c = validateSpec({ kind: 'chart', chartType: 'bar', series: { dimension: '区域', limit: 9999 } }, FIELDS) as any
    expect(c.series.limit).toBe(200)
    const t = validateSpec({ kind: 'table', pageSize: 9999 }, FIELDS) as any
    expect(t.pageSize).toBe(100)
  })

  it('drops dashboard filters/kpis referencing unknown fields, keeps valid ones', () => {
    const d = validateSpec({
      kind: 'dashboard',
      filters: ['状态', '幻觉字段'],
      kpis: [{ label: '总额', value: { op: 'sum', field: '金额' } }, { label: '坏', value: { op: 'sum', field: '没有' } }],
      charts: [{ kind: 'chart', chartType: 'pie', series: { dimension: '区域' } }],
    }, FIELDS) as any
    expect(d.filters).toEqual(['状态'])
    expect(d.kpis).toHaveLength(2)             // both labels kept
    expect(d.kpis[1].value.field).toBeUndefined() // unknown field dropped → falls back to count-like
    expect(d.charts).toHaveLength(1)
  })

  it('accepts rawChart option as-is', () => {
    const r = validateSpec({ kind: 'rawChart', option: { series: [{ type: 'pie', data: [] }] } }, FIELDS) as any
    expect(r.kind).toBe('rawChart')
    expect(r.option.series[0].type).toBe('pie')
  })

  it('sanitizes a site spec (sections + nested dashboard)', () => {
    const s = validateSpec({
      kind: 'site', title: 'X',
      sections: [{ type: 'hero', title: 'Hi' }, { type: 'bogus' }],
      dashboard: { kind: 'dashboard', charts: [{ kind: 'chart', chartType: 'bar', series: { dimension: '区域' } }] },
    }, FIELDS) as any
    expect(s.sections).toHaveLength(1)
    expect(s.dashboard.charts).toHaveLength(1)
  })

  it('with no field list, does not drop fields (permissive)', () => {
    const c = validateSpec({ kind: 'chart', chartType: 'line', series: { dimension: 'anything' } }) as any
    expect(c.series.dimension).toBe('anything')
  })
})
