import { describe, it, expect } from 'vitest'
import { parseFilterFormula } from './api'

describe('parseFilterFormula', () => {
  it('parses a single equality condition', () => {
    expect(parseFilterFormula('CurrentValue.[状态]="待处理"')).toEqual({
      conjunction: 'and',
      conditions: [{ field_name: '状态', operator: 'is', value: ['待处理'] }],
    })
  })

  it('maps != to isNot and strips quotes', () => {
    expect(parseFilterFormula('CurrentValue.[状态]!="已完成"')).toEqual({
      conjunction: 'and',
      conditions: [{ field_name: '状态', operator: 'isNot', value: ['已完成'] }],
    })
  })

  it('parses numeric comparison operators', () => {
    expect(parseFilterFormula('CurrentValue.[金额]>=100')).toEqual({
      conjunction: 'and',
      conditions: [{ field_name: '金额', operator: 'isGreaterEqual', value: ['100'] }],
    })
    expect(parseFilterFormula('CurrentValue.[数量]<5').conditions[0]).toEqual({
      field_name: '数量', operator: 'isLess', value: ['5'],
    })
  })

  it('parses AND(...) into multiple and-joined conditions', () => {
    expect(parseFilterFormula('AND(CurrentValue.[优先级]="高", CurrentValue.[状态]!="已完成")')).toEqual({
      conjunction: 'and',
      conditions: [
        { field_name: '优先级', operator: 'is', value: ['高'] },
        { field_name: '状态', operator: 'isNot', value: ['已完成'] },
      ],
    })
  })

  it('parses OR(...) with the or conjunction', () => {
    const r = parseFilterFormula('OR(CurrentValue.[地区]="北京", CurrentValue.[地区]="上海")')
    expect(r.conjunction).toBe('or')
    expect(r.conditions).toHaveLength(2)
  })

  it('does not split on commas inside a quoted value', () => {
    expect(parseFilterFormula('CurrentValue.[备注]="北京, 上海"')).toEqual({
      conjunction: 'and',
      conditions: [{ field_name: '备注', operator: 'is', value: ['北京, 上海'] }],
    })
  })

  it('throws on an unparseable filter instead of matching everything', () => {
    expect(() => parseFilterFormula('状态 == 待办')).toThrow(/无法解析过滤条件/)
    expect(() => parseFilterFormula('CurrentValue.[状态].contains("x")')).toThrow(/无法解析过滤条件/)
  })
})
