// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { parseCsv, rowsToMarkdown, fileToClip } from './file'

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('handles a quoted field with an embedded comma', () => {
    expect(parseCsv('"a,b",c')).toEqual([['a,b', 'c']])
  })
  it('handles escaped quotes ("")', () => {
    expect(parseCsv('"she said ""hi""",x')).toEqual([['she said "hi"', 'x']])
  })
  it('handles an embedded newline inside quotes', () => {
    expect(parseCsv('"line1\nline2",b')).toEqual([['line1\nline2', 'b']])
  })
  it('handles CRLF endings and strips a BOM', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('drops blank lines', () => {
    expect(parseCsv('a,b\n\n1,2')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('parses TSV with a tab delimiter', () => {
    expect(parseCsv('a\tb\n1\t2', '\t')).toEqual([['a', 'b'], ['1', '2']])
  })
})

describe('rowsToMarkdown', () => {
  it('renders a Markdown table', () => {
    const md = rowsToMarkdown([['名称', '价格'], ['谷歌', '$372']])
    expect(md).toContain('| 名称 | 价格 |')
    expect(md).toMatch(/\| --- \| --- \|/)
    expect(md).toContain('| 谷歌 | $372 |')
  })
  it('escapes pipes inside cells', () => {
    expect(rowsToMarkdown([['a|b', 'c'], ['1', '2']])).toContain('a/b')
  })
  it('falls back to plain text for single-column input', () => {
    expect(rowsToMarkdown([['只有一列'], ['第二行']])).toBe('只有一列\n第二行')
  })
})

describe('fileToClip', () => {
  const mk = (name: string, content: string, type = '') => new File([content], name, { type })

  it('turns a CSV file into a ClipCapture with a Markdown table', async () => {
    const clip = await fileToClip(mk('sales.csv', '名称,价格\n谷歌,$372'))
    expect(clip.url).toBe('file://sales.csv')
    expect(clip.title).toBe('sales.csv')
    expect(clip.selectedText).toBe('')
    expect(clip.content).toContain('| 名称 | 价格 |')
    expect(clip.content).toContain('| 谷歌 | $372 |')
  })

  it('uses raw text for a .txt file', async () => {
    const clip = await fileToClip(mk('note.txt', '随便一段文字'))
    expect(clip.content).toBe('随便一段文字')
  })

  it('rejects unsupported types with a friendly "另存为 CSV" message', async () => {
    await expect(fileToClip(mk('data.xlsx', 'PKbinary'))).rejects.toThrow(/另存为 CSV/)
  })
})
