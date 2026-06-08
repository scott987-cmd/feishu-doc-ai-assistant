import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockChat = vi.fn()
vi.mock('./llm', () => ({ chatComplete: (...a: unknown[]) => mockChat(...a) }))

const { generateReport } = await import('./report')
const { DEFAULT_SETTINGS } = await import('../types')

const settings = { ...DEFAULT_SETTINGS, openaiBaseUrl: 'https://api.example.com/v1', openaiApiKey: 'sk', openaiModel: 'gpt-4o' }
const input = {
  schema: [{ name: '地区', type: 'Text' }, { name: '销量', type: 'Number' }],
  profile: {
    rowCount: 3, fieldCount: 2,
    fields: [{ name: '销量', type: 'Number', fillRate: 1, kind: 'numeric', count: 3, sum: 600, avg: 200, min: 100, max: 300 }],
  },
  sampleRows: [{ 地区: '华东', 销量: '100' }],
  focus: '看销量',
  sourceKind: 'base',
} as Parameters<typeof generateReport>[1]

const reply = (content: string) => mockChat.mockResolvedValue(content)

describe('generateReport', () => {
  beforeEach(() => mockChat.mockReset())

  it('parses {title, markdown} and sends profile + sample + focus, forbidding md tables', async () => {
    reply(JSON.stringify({ title: '销量分析', markdown: '## 摘要\n- 总销量 600' }))
    const r = await generateReport(settings, input)
    expect(r.title).toBe('销量分析')
    expect(r.markdown).toContain('总销量 600')
    const sent = mockChat.mock.calls[0][1] as string
    expect(sent).toContain('看销量')                 // focus
    expect(sent).toContain('600')                     // a real profile number
    expect(sent).toContain('不要用 markdown 表格')     // the no-table rule
  })

  it('strips ```json fences', async () => {
    reply('```json\n{"title":"T","markdown":"## 摘要\\n内容"}\n```')
    expect((await generateReport(settings, input)).title).toBe('T')
  })

  it('falls back to the focus/default title when the model omits it', async () => {
    reply(JSON.stringify({ markdown: '## 摘要\n内容' }))
    expect((await generateReport(settings, input)).title).toBe('看销量')
  })

  it('throws on non-JSON output and on an empty body', async () => {
    reply('就是一段普通文字')
    await expect(generateReport(settings, input)).rejects.toThrow(/JSON/)
    reply(JSON.stringify({ title: 'T', markdown: '' }))
    await expect(generateReport(settings, input)).rejects.toThrow(/正文/)
  })
})
