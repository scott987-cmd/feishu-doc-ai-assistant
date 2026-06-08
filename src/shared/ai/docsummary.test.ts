import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockChat = vi.fn()
vi.mock('./llm', () => ({ chatComplete: (...a: unknown[]) => mockChat(...a) }))

const { summarizeDoc } = await import('./docsummary')
const { DEFAULT_SETTINGS } = await import('../types')

const settings = { ...DEFAULT_SETTINGS, openaiBaseUrl: 'https://api.example.com/v1', openaiApiKey: 'sk', openaiModel: 'gpt-4o' }
const reply = (content: string) => mockChat.mockResolvedValue(content)

describe('summarizeDoc', () => {
  beforeEach(() => mockChat.mockReset())

  it('sends the document text + default prompt; returns the summary', async () => {
    reply('## 摘要\n这是总结')
    const out = await summarizeDoc(settings, '独一无二的文档XYZ')
    expect(out).toContain('这是总结')
    const sent = mockChat.mock.calls[0][1] as string
    expect(sent).toContain('独一无二的文档XYZ')
    expect(sent).toContain('分条列出') // a default-prompt phrase
  })

  it('uses a CUSTOM prompt when provided (user-editable summary prompt)', async () => {
    reply('一句话总结')
    await summarizeDoc(settings, 'doc', '只用一句话概括，越短越好')
    const sent = mockChat.mock.calls[0][1] as string
    expect(sent).toContain('只用一句话概括，越短越好')
    expect(sent).not.toContain('分条列出') // the default prompt is replaced
  })

  it('strips accidental markdown code fences', async () => {
    reply('```markdown\n# 标题\n内容\n```')
    expect(await summarizeDoc(settings, 'doc')).toBe('# 标题\n内容')
  })

  it('throws when the model returns nothing', async () => {
    reply('')
    await expect(summarizeDoc(settings, 'doc')).rejects.toThrow(/未返回/)
  })
})
