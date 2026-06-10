import { describe, it, expect } from 'vitest'
import { validateSpec, referencedFields } from './spec'

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

  it('keeps a chart even if the dimension is not in the passed schema (no blank — degrade gracefully)', () => {
    const c = validateSpec({ kind: 'chart', chartType: 'bar', series: { dimension: '不在schema里' } }, FIELDS) as any
    expect(c.kind).toBe('chart')
    expect(c.series.dimension).toBe('不在schema里')
  })

  it('clamps series.limit and pageSize', () => {
    const c = validateSpec({ kind: 'chart', chartType: 'bar', series: { dimension: '区域', limit: 9999 } }, FIELDS) as any
    expect(c.series.limit).toBe(200)
    const t = validateSpec({ kind: 'table', pageSize: 9999 }, FIELDS) as any
    expect(t.pageSize).toBe(100)
  })

  it('keeps dashboard filters/kpis/charts as-is (no field-dropping → no blank)', () => {
    const d = validateSpec({
      kind: 'dashboard',
      filters: ['状态', '其它字段'],
      kpis: [{ label: '总额', value: { op: 'sum', field: '金额' } }, { label: '订单', value: { op: 'sum', field: '订单数' } }],
      charts: [{ kind: 'chart', chartType: 'pie', series: { dimension: '区域' } }],
    }, FIELDS) as any
    expect(d.filters).toEqual(['状态', '其它字段'])  // kept, not dropped
    expect(d.kpis).toHaveLength(2)
    expect(d.kpis[0].value.field).toBe('金额')
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

  it('referencedFields collects dimensions/measures/filters/columns for the unmatched-field warning', () => {
    const d = validateSpec({
      kind: 'dashboard',
      filters: ['状态'],
      kpis: [{ label: '额', value: { op: 'sum', field: '金额', where: [{ field: '区域', op: 'eq', value: '华东' }] } }],
      charts: [{ kind: 'chart', chartType: 'bar', series: { dimension: '产品' } }],
      table: { columns: [{ key: '订单数' }] },
    }, FIELDS)
    const refs = referencedFields(d)
    expect(refs.sort()).toEqual(['产品', '区域', '金额', '订单数', '状态'].sort())
    // diff against a schema → the unmatched ones drive the user warning
    const known = new Set(['金额', '状态'])
    expect(refs.filter((f) => !known.has(f)).sort()).toEqual(['产品', '区域', '订单数'].sort())
  })

  it('with no field list, does not drop fields (permissive)', () => {
    const c = validateSpec({ kind: 'chart', chartType: 'line', series: { dimension: 'anything' } }) as any
    expect(c.series.dimension).toBe('anything')
  })
})
