import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockChat = vi.fn()
vi.mock('./llm', () => ({ chatComplete: (...a: unknown[]) => mockChat(...a) }))

const { auditDocument } = await import('./docaudit')
const { DEFAULT_SETTINGS } = await import('../types')

const settings = { ...DEFAULT_SETTINGS, openaiBaseUrl: 'https://api.example.com/v1', openaiApiKey: 'sk', openaiModel: 'gpt-4o' }
const reply = (content: string) => mockChat.mockResolvedValue(content)

describe('auditDocument', () => {
  beforeEach(() => mockChat.mockReset())

  it('parses {issues:[...]} and normalizes type/severity/missing fields', async () => {
    reply(JSON.stringify({ issues: [
      { type: '矛盾', severity: 'high', quote: 'A 与 B', problem: '前后数字不一致', suggestion: '统一口径' },
      { type: 'TODO', severity: 'weird', quote: '待补充', problem: '遗留占位' },
    ] }))
    const issues = await auditDocument(settings, '文档内容…')
    expect(issues).toHaveLength(2)
    expect(issues[0]).toMatchObject({ type: '矛盾', severity: 'high', problem: '前后数字不一致' })
    expect(issues[1].severity).toBe('medium') // unknown severity → medium
    expect(issues[1].suggestion).toBe('')     // missing → ''
  })

  it('puts the document text + default check dimensions into the prompt', async () => {
    reply(JSON.stringify({ issues: [] }))
    await auditDocument(settings, '独一无二的文档片段XYZ')
    const sent = mockChat.mock.calls[0][1] as string
    expect(sent).toContain('独一无二的文档片段XYZ')
    expect(sent).toContain('文档审校')
    expect(sent).toContain('逻辑断点') // a default check item
  })

  it('uses a CUSTOM check when one is provided (user-editable check)', async () => {
    reply(JSON.stringify({ issues: [] }))
    await auditDocument(settings, 'doc', '只看：错别字、以及数字前后不一致')
    const sent = mockChat.mock.calls[0][1] as string
    expect(sent).toContain('只看：错别字、以及数字前后不一致')
    expect(sent).not.toContain('逻辑断点') // the default dimensions are replaced
  })

  it('returns [] when the model finds nothing', async () => {
    reply(JSON.stringify({ issues: [] }))
    expect(await auditDocument(settings, 'clean doc')).toEqual([])
  })

  it('drops entries with neither a problem nor a quote', async () => {
    reply(JSON.stringify({ issues: [{ type: '其它', severity: 'low' }, { problem: '真问题' }] }))
    const issues = await auditDocument(settings, 'x')
    expect(issues).toHaveLength(1)
    expect(issues[0].problem).toBe('真问题')
  })

  it('throws on non-JSON output', async () => {
    reply('就是一段普通文字')
    await expect(auditDocument(settings, 'x')).rejects.toThrow(/JSON/)
  })
})
