import { describe, it, expect } from 'vitest'
import { markdownToBlocks, buildBlock, buildTableDescendants, splitSheetToken, markdownToSegments, hasMarkdownTable } from './docx'

describe('markdownToSegments — tables become real table segments, not raw text', () => {
  it('splits text + table + text in order', () => {
    const md = '# 标题\n说明文字\n\n| 区域 | 销量 |\n| --- | --- |\n| 华东 | 100 |\n| 华南 | 50 |\n\n结尾段落'
    const segs = markdownToSegments(md)
    expect(segs.map((s) => s.kind)).toEqual(['blocks', 'table', 'blocks'])
    const table = segs.find((s) => s.kind === 'table') as { kind: 'table'; rows: string[][] }
    expect(table.rows).toEqual([['区域', '销量'], ['华东', '100'], ['华南', '50']])
  })
  it('does NOT treat a | line inside a code fence as a table', () => {
    const md = '```\n| not | a | table |\n| --- | --- | --- |\n```'
    const segs = markdownToSegments(md)
    expect(segs.every((s) => s.kind === 'blocks')).toBe(true)
  })
  it('hasMarkdownTable detects the |row|+|---| pattern only', () => {
    expect(hasMarkdownTable('| a | b |\n| - | - |\n| 1 | 2 |')).toBe(true)
    expect(hasMarkdownTable('普通文字，含 | 竖线 但不是表')).toBe(false)
  })
})

// markdownToBlocks powers create_doc_from_markdown — wrong parsing = broken docs.
describe('markdownToBlocks', () => {
  const types = (md: string) => markdownToBlocks(md).map((b) => b.style)

  it('maps headings / list / quote / code / todo / divider styles', () => {
    expect(types('# H1')).toEqual(['h1'])
    expect(types('## H2')).toEqual(['h2'])
    expect(types('- item')).toEqual(['bullet'])
    expect(types('1. first')).toEqual(['ordered'])
    expect(types('> quote')).toEqual(['quote'])
    expect(types('- [ ] todo')).toEqual(['todo'])
    expect(types('---')).toEqual(['divider'])
    expect(types('plain text')).toEqual(['text'])
  })

  it('keeps a fenced code block as one code block (not per-line)', () => {
    const blocks = markdownToBlocks('```js\nconst a = 1\nconst b = 2\n```')
    const code = blocks.filter((b) => b.style === 'code')
    expect(code).toHaveLength(1)
    expect(code[0].text).toContain('const a = 1')
    expect(code[0].text).toContain('const b = 2')
  })

  it('parses a multi-line document into ordered blocks', () => {
    expect(types('# 标题\n\n正文段落\n\n- 要点一\n- 要点二')).toEqual(['h1', 'text', 'bullet', 'bullet'])
  })
})

describe('buildBlock — block_type codes', () => {
  it('uses the verified type codes (text=2, h1=3, divider=22)', () => {
    expect(buildBlock({ style: 'text', text: 'x' }).block_type).toBe(2)
    expect(buildBlock({ style: 'h1', text: 'x' }).block_type).toBe(3)
    expect(buildBlock({ style: 'divider', text: '' }).block_type).toBe(22)
  })
  it('divider carries an empty divider object (not text)', () => {
    expect(buildBlock({ style: 'divider', text: '' })).toHaveProperty('divider')
  })
})

// insertTable now builds a one-shot `descendant` payload — these guard the structure the
// Feishu API requires (row-major cells, every cell has a child, header row).
describe('buildTableDescendants', () => {
  it('builds table(31) → cells(32) → text(2), row-major, with a header row', () => {
    const { children_id, descendants, rows, cols } = buildTableDescendants([['姓名', '分数'], ['张三', '90']])
    expect(rows).toBe(2)
    expect(cols).toBe(2)
    expect(children_id).toEqual(['tbl'])
    const table = descendants.find((d) => d.block_type === 31)!
    expect((table.table as { property: Record<string, unknown> }).property).toMatchObject({ row_size: 2, column_size: 2, header_row: true })
    expect(table.children).toEqual(['c_0_0', 'c_0_1', 'c_1_0', 'c_1_1']) // row-major order
    expect(descendants.filter((d) => d.block_type === 32)).toHaveLength(4)
    expect(JSON.stringify(descendants.find((d) => d.block_id === 't_0_0')!.text)).toContain('姓名')
    expect(JSON.stringify(descendants.find((d) => d.block_id === 't_1_1')!.text)).toContain('90')
  })

  it('gives every cell a child text block — even empty cells (Feishu rejects empty cells)', () => {
    const { descendants } = buildTableDescendants([['a', ''], ['', 'd']])
    for (const cell of descendants.filter((d) => d.block_type === 32)) {
      expect(cell.children).toHaveLength(1)
      const child = descendants.find((d) => d.block_id === cell.children![0])
      expect(child?.block_type).toBe(2)
    }
  })
})

describe('splitSheetToken', () => {
  it('splits {spreadsheetToken}_{sheetId} on the LAST underscore', () => {
    expect(splitSheetToken('LxvrsycFwhQ_QJ6HZR')).toEqual({ spreadsheetToken: 'LxvrsycFwhQ', sheetId: 'QJ6HZR' })
    expect(splitSheetToken('abc_def_XYZ')).toEqual({ spreadsheetToken: 'abc_def', sheetId: 'XYZ' })
  })
  it('returns null when there is no usable underscore', () => {
    expect(splitSheetToken('nounderscore')).toBeNull()
    expect(splitSheetToken('_leading')).toBeNull()
    expect(splitSheetToken('trailing_')).toBeNull()
  })
})
