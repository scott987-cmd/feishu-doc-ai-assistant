import { describe, it, expect } from 'vitest'
import { inferColType } from './data'

// Spreadsheets carry no per-field type metadata, so a column's type is sniffed from its
// values by majority. These cases pin the thresholds (Number / Percent / DateTime / Text).
describe('inferColType', () => {
  it('detects numbers including currency and thousands separators', () => {
    expect(inferColType(['100', '1,200', '¥350'])).toBe('Number')
  })
  it('detects percentages', () => {
    expect(inferColType(['12%', '8.5%', '100%'])).toBe('Percent')
  })
  it('detects dates (slash / dash / with time)', () => {
    expect(inferColType(['2024-01-01', '2024/02/15', '2023-12-31 09:30'])).toBe('DateTime')
  })
  it('single-dot decimals are Number, not DateTime (else-if disambiguation)', () => {
    expect(inferColType(['2024.5', '2023.1', '2022.8'])).toBe('Number')
  })
  it('falls back to Text for labels', () => {
    expect(inferColType(['华东', '华南', '华北'])).toBe('Text')
  })
  it('ignores blanks; empty column is Text', () => {
    expect(inferColType(['', '  ', ''])).toBe('Text')
    expect(inferColType(['100', '', '200'])).toBe('Number')
  })
  it('stays Text when the dominant type is below threshold', () => {
    expect(inferColType(['100', 'N/A', '待定', '——'])).toBe('Text')
  })
})
