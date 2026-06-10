import { describe, it, expect } from 'vitest'
import { evalAggregate, evalFilter, groupSeries, buildOption, actionTemplate, formatValue, num } from './interpret'
import type { ChartSpec } from './spec'

const rows = [
  { 区域: '华东', 金额: '100', 状态: '完成' },
  { 区域: '华东', 金额: '200', 状态: '进行中' },
  { 区域: '华南', 金额: '50', 状态: '完成' },
  { 区域: '华南', 金额: '¥1,000', 状态: '完成' },
  { 区域: '华北', 金额: '', 状态: '完成' },
]

describe('interpret — num parsing', () => {
  it('strips currency/commas, NaN for non-numeric', () => {
    expect(num('¥1,000')).toBe(1000)
    expect(num('85%')).toBe(85)
    expect(Number.isNaN(num('abc'))).toBe(true)
  })
  it('rejects dates/ranges/multi-sign as NaN (strict, not parseFloat)', () => {
    expect(Number.isNaN(num('2024-01'))).toBe(true)
    expect(Number.isNaN(num('1-3'))).toBe(true)
    expect(Number.isNaN(num('1.2.3'))).toBe(true)
    expect(Number.isNaN(num(''))).toBe(true)
  })
})

describe('interpret — evalAggregate', () => {
  it('count / countDistinct', () => {
    expect(evalAggregate(rows, { op: 'count' })).toBe(5)
    expect(evalAggregate(rows, { op: 'countDistinct', field: '区域' })).toBe(3)
  })
  it('sum / avg / min / max ignore blanks & parse currency', () => {
    expect(evalAggregate(rows, { op: 'sum', field: '金额' })).toBe(1350)
    expect(evalAggregate(rows, { op: 'avg', field: '金额' })).toBe(1350 / 4)
    expect(evalAggregate(rows, { op: 'min', field: '金额' })).toBe(50)
    expect(evalAggregate(rows, { op: 'max', field: '金额' })).toBe(1000)
  })
  it('applies where filter before aggregating', () => {
    expect(evalAggregate(rows, { op: 'count', where: [{ field: '状态', op: 'eq', value: '完成' }] })).toBe(4)
    expect(evalAggregate(rows, { op: 'sum', field: '金额', where: [{ field: '区域', op: 'eq', value: '华南' }] })).toBe(1050)
  })
})

describe('interpret — evalFilter', () => {
  it('eq/ne/contains/in/gt', () => {
    expect(evalFilter(rows[0], [{ field: '状态', op: 'eq', value: '完成' }])).toBe(true)
    expect(evalFilter(rows[1], [{ field: '状态', op: 'ne', value: '完成' }])).toBe(true)
    expect(evalFilter(rows[0], [{ field: '区域', op: 'contains', value: '华' }])).toBe(true)
    expect(evalFilter(rows[0], [{ field: '区域', op: 'in', value: ['华东', '华南'] }])).toBe(true)
    expect(evalFilter(rows[0], [{ field: '区域', op: 'in', value: '华东' as unknown as string[] }])).toBe(true) // scalar tolerated
    expect(evalFilter(rows[1], [{ field: '金额', op: 'gt', value: 150 }])).toBe(true)
    expect(evalFilter(rows[0], [{ field: '金额', op: 'gt', value: 150 }])).toBe(false)
  })
  it('empty clauses pass all', () => {
    expect(evalFilter(rows[0])).toBe(true)
  })
})

describe('interpret — groupSeries + buildOption', () => {
  it('groups by dimension, sums measure, sorts desc, limits', () => {
    const pts = groupSeries(rows, { dimension: '区域', measure: { op: 'sum', field: '金额' }, sort: 'value-desc' })
    expect(pts).toEqual([{ label: '华南', value: 1050 }, { label: '华东', value: 300 }, { label: '华北', value: 0 }])
  })
  it('default measure is count', () => {
    const pts = groupSeries(rows, { dimension: '状态' })
    expect(pts.find((p) => p.label === '完成')!.value).toBe(4)
  })
  it('top-N limit', () => {
    expect(groupSeries(rows, { dimension: '区域', limit: 1 }).length).toBe(1)
  })
  it('bar option has category labels + value series', () => {
    const opt = buildOption(rows, { kind: 'chart', chartType: 'bar', series: { dimension: '区域', measure: { op: 'count' } } } as ChartSpec) as any
    expect(opt.xAxis.data).toContain('华东')
    expect(opt.series[0].type).toBe('bar')
    expect(opt.series[0].data.length).toBe(3)
  })
  it('pie option emits {name,value} data', () => {
    const opt = buildOption(rows, { kind: 'chart', chartType: 'pie', series: { dimension: '区域' } } as ChartSpec) as any
    expect(opt.series[0].type).toBe('pie')
    expect(opt.series[0].data[0]).toHaveProperty('name')
    expect(opt.series[0].data[0]).toHaveProperty('value')
  })
})

describe('interpret — actionTemplate & formatValue', () => {
  it('substitutes {field} placeholders', () => {
    expect(actionTemplate(rows[0], '跟进 {区域} 的 {状态}')).toBe('跟进 华东 的 完成')
    expect(actionTemplate(rows[0], '缺 {不存在}')).toBe('缺 ')
  })
  it('formats values', () => {
    expect(formatValue(1234.5, 'int')).toBe('1,235')
    expect(formatValue(1234.5, 'float2')).toBe('1234.50')
    expect(formatValue(85, 'percent')).toBe('85.0%')
  })
})
