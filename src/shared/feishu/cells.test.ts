import { describe, it, expect } from 'vitest'
import { cellToString, cellToNumber } from './compose'

// These two underpin summarize / dedupe / audit / cross-table — wrong conversions
// corrupt grouping keys and aggregates, so lock their behavior.
describe('cellToString — flatten any Base cell to text', () => {
  it('passes through primitives', () => {
    expect(cellToString('hi')).toBe('hi')
    expect(cellToString(42)).toBe('42')
    expect(cellToString(true)).toBe('true')
  })
  it('returns empty for null/undefined', () => {
    expect(cellToString(null)).toBe('')
    expect(cellToString(undefined)).toBe('')
  })
  it('joins arrays (multi-select / people)', () => {
    expect(cellToString(['a', 'b', 'c'])).toBe('a, b, c')
    expect(cellToString([{ name: '张三' }, { name: '李四' }])).toBe('张三, 李四')
  })
  it('extracts text/name/value from rich objects', () => {
    expect(cellToString({ text: '富文本' })).toBe('富文本')
    expect(cellToString({ name: '选项A' })).toBe('选项A')
    expect(cellToString({ value: 7 })).toBe('7')
  })
})

describe('cellToNumber — parse numeric cells', () => {
  it('parses plain numbers and numeric strings', () => {
    expect(cellToNumber(42)).toBe(42)
    expect(cellToNumber('3.14')).toBe(3.14)
  })
  it('strips currency / percent / thousands separators', () => {
    expect(cellToNumber('¥1,234.50')).toBe(1234.5)
    expect(cellToNumber('80%')).toBe(80)
    expect(cellToNumber('$1,000')).toBe(1000)
  })
  it('returns 0 for non-numeric / empty', () => {
    expect(cellToNumber('abc')).toBe(0)
    expect(cellToNumber(null)).toBe(0)
    expect(cellToNumber('')).toBe(0)
  })
})
