import { describe, it, expect } from 'vitest'
import { parseFeishuContext, cleanDocTitle } from './pageUrl'

describe('parseFeishuContext', () => {
  it('extracts appToken / table / view from a Base URL', () => {
    expect(
      parseFeishuContext('https://acme.feishu.cn/base/BascnExampleAppToken1?table=tblPBfzxFHdDBljy&view=vewl3uCDrP')
    ).toEqual({
      isBase: true,
      kind: 'base',
      appToken: 'BascnExampleAppToken1',
      tableId: 'tblPBfzxFHdDBljy',
      viewId: 'vewl3uCDrP',
    })
  })

  it('works without query params', () => {
    expect(parseFeishuContext('https://x.feishu.cn/base/AbC123')).toEqual({
      isBase: true,
      kind: 'base',
      appToken: 'AbC123',
      tableId: undefined,
      viewId: undefined,
    })
  })

  it('detects a Spreadsheet URL', () => {
    expect(parseFeishuContext('https://x.feishu.cn/sheets/Sht123abc?sheet=0')).toEqual({
      isBase: false, kind: 'sheet', spreadsheetToken: 'Sht123abc',
    })
  })

  it('detects a Doc URL (docx and docs)', () => {
    expect(parseFeishuContext('https://x.feishu.cn/docx/Doc987zzz')).toEqual({
      isBase: false, kind: 'doc', documentId: 'Doc987zzz',
    })
    expect(parseFeishuContext('https://x.feishu.cn/docs/Old123')).toEqual({
      isBase: false, kind: 'doc', documentId: 'Old123',
    })
  })

  it('tags Base URLs with kind: base', () => {
    expect(parseFeishuContext('https://x.feishu.cn/base/AbC123')?.kind).toBe('base')
  })

  it('detects a wiki node URL (unresolved until API lookup)', () => {
    expect(parseFeishuContext('https://acme.feishu.cn/wiki/WikiExampleNodeToken1')).toEqual({
      isBase: false, kind: 'wiki', wikiToken: 'WikiExampleNodeToken1',
    })
  })

  it('returns undefined for non-resource URLs', () => {
    expect(parseFeishuContext('https://feishu.cn/drive/folder/xxx')).toBeUndefined()
    expect(parseFeishuContext('https://example.com')).toBeUndefined()
  })
})

describe('cleanDocTitle', () => {
  it('strips the trailing 飞书/Feishu/Lark app suffix', () => {
    expect(cleanDocTitle('季度复盘 - 飞书云文档')).toBe('季度复盘')
    expect(cleanDocTitle('Roadmap - Feishu Docs')).toBe('Roadmap')
    expect(cleanDocTitle('Budget | Lark Sheets')).toBe('Budget')
    expect(cleanDocTitle('销售表 — 飞书表格')).toBe('销售表')
  })

  it('does NOT over-strip a doc name that itself contains 飞书', () => {
    expect(cleanDocTitle('飞书团队周报 - 飞书云文档')).toBe('飞书团队周报')
    expect(cleanDocTitle('周报 - 飞书团队 - 飞书云文档')).toBe('周报 - 飞书团队')
  })

  it('rejects the placeholder titles shown DURING SPA navigation (returns "")', () => {
    expect(cleanDocTitle('飞书')).toBe('')
    expect(cleanDocTitle('Feishu')).toBe('')
    expect(cleanDocTitle('飞书云文档')).toBe('')
    expect(cleanDocTitle('加载中')).toBe('')
    expect(cleanDocTitle('')).toBe('')
    expect(cleanDocTitle('   ')).toBe('')
  })

  it('keeps a plain title unchanged', () => {
    expect(cleanDocTitle('我的文档')).toBe('我的文档')
  })

  it('strips private/on-prem brand suffixes but not real names ending in 文档/表格', () => {
    expect(cleanDocTitle('季度销售 - kastd云文档')).toBe('季度销售')
    expect(cleanDocTitle('项目计划 - MyCorp Docs')).toBe('项目计划')
    expect(cleanDocTitle('项目文档')).toBe('项目文档')   // real name, not a brand suffix → kept
    expect(cleanDocTitle('云文档')).toBe('')
  })
})
