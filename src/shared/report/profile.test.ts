import { describe, it, expect } from 'vitest'
import { profileTable } from './profile'

const f = (name: string, type = 'Text') => ({ name, type })

describe('profileTable', () => {
  it('detects numeric columns by VALUE even when the schema type is Text (Sheets)', () => {
    const p = profileTable([f('销量')], [{ 销量: '100' }, { 销量: '200' }, { 销量: '300' }])
    const fld = p.fields[0]
    expect(fld.kind).toBe('numeric')
    if (fld.kind === 'numeric') {
      expect(fld.sum).toBe(600); expect(fld.avg).toBe(200); expect(fld.min).toBe(100); expect(fld.max).toBe(300)
    }
  })

  it('strips currency/separators when summing', () => {
    const fld = profileTable([f('金额')], [{ 金额: '¥1,000' }, { 金额: '2,000' }]).fields[0]
    expect(fld.kind).toBe('numeric')
    if (fld.kind === 'numeric') expect(fld.sum).toBe(3000)
  })

  it('profiles a categorical column with top-K counts and distinct count', () => {
    const fld = profileTable([f('地区')], [{ 地区: '华东' }, { 地区: '华东' }, { 地区: '华北' }]).fields[0]
    expect(fld.kind).toBe('category')
    if (fld.kind === 'category') {
      expect(fld.distinct).toBe(2)
      expect(fld.topValues[0]).toEqual({ value: '华东', count: 2 })
    }
  })

  it('detects dates by the Base type hint', () => {
    const fld = profileTable([f('签约日期', '日期')], [{ 签约日期: '2024-01-01' }, { 签约日期: '2024-03-15' }]).fields[0]
    expect(fld.kind).toBe('date')
    if (fld.kind === 'date') { expect(fld.minDate).toBe('2024-01-01'); expect(fld.maxDate).toBe('2024-03-15') }
  })

  it('computes fill rate + row/field counts; blank values are not counted', () => {
    const p = profileTable([f('A'), f('B')], [{ A: 'x', B: '' }, { A: 'y', B: '2' }])
    expect(p.rowCount).toBe(2)
    expect(p.fieldCount).toBe(2)
    expect(p.fields[0].fillRate).toBe(1)   // A full
    expect(p.fields[1].fillRate).toBe(0.5) // B half-empty
  })
})
