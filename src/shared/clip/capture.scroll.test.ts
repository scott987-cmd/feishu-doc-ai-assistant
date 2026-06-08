import { describe, it, expect } from 'vitest'
import { mergeTableRows } from './capture'

const fresh = () => ({ header: null as string[] | null, out: [] as string[][], seen: new Set<string>() })

describe('mergeTableRows (scroll accumulation)', () => {
  it('first batch sets the header and keeps all rows', () => {
    const acc = fresh()
    const added = mergeTableRows(acc, [['名称', '价格'], ['谷歌', '$1'], ['苹果', '$2']])
    expect(acc.header).toEqual(['名称', '价格'])
    expect(acc.out).toHaveLength(3)
    expect(added).toBe(2)
  })

  it('dedups overlapping rows across batches, adds only new ones', () => {
    const acc = fresh()
    mergeTableRows(acc, [['h1', 'h2'], ['a', '1'], ['b', '2']])
    const added = mergeTableRows(acc, [['b', '2'], ['c', '3']]) // b,2 overlaps the prior batch
    expect(added).toBe(1)
    expect(acc.out.map((r) => r[0])).toEqual(['h1', 'a', 'b', 'c'])
  })

  it('does not lose row 0 of a later batch (headerless-grid safety)', () => {
    const acc = fresh()
    mergeTableRows(acc, [['a', '1'], ['b', '2']]) // a,1 becomes header
    const added = mergeTableRows(acc, [['c', '3'], ['d', '4']]) // both new, row 0 must count
    expect(added).toBe(2)
    expect(acc.out.map((r) => r[0])).toEqual(['a', 'b', 'c', 'd'])
  })

  it('skips a repeated (sticky) header appearing in a later batch', () => {
    const acc = fresh()
    mergeTableRows(acc, [['h1', 'h2'], ['a', '1']])
    const added = mergeTableRows(acc, [['h1', 'h2'], ['x', '9']]) // header repeats at row 0
    expect(added).toBe(1)
    expect(acc.out).toHaveLength(3) // header, a, x
  })

  it('empty / null batch adds nothing', () => {
    const acc = fresh()
    expect(mergeTableRows(acc, [])).toBe(0)
    expect(mergeTableRows(acc, null)).toBe(0)
  })
})
