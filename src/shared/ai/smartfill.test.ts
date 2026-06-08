import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()
vi.mock('openai', () => ({ default: class { chat = { completions: { create: mockCreate } } } }))

const { inferFills, buildPrompt } = await import('./smartfill')
const { DEFAULT_SETTINGS } = await import('../types')

const settings = { ...DEFAULT_SETTINGS, openaiBaseUrl: 'https://api.example.com/v1', openaiApiKey: 'sk', openaiModel: 'gpt-4o' }
const input = {
  field: { id: 'f', name: '行业', type: 3, options: ['互联网', '金融'] },
  sourceFields: ['公司', '职位'],
  examples: [{ 公司: '星辰', 职位: '工程师', 行业: '互联网' }],
  rows: [{ key: 'r0', cells: { 公司: '未来教育', 职位: '老师' } }],
  instruction: '按公司推断',
}
const reply = (content: string) => mockCreate.mockResolvedValue({ choices: [{ message: { content } }] })

describe('buildPrompt', () => {
  it('includes target field, option list + no-invent rule, source fields, instruction, and the stable-key contract', () => {
    const p = buildPrompt(input)
    expect(p).toContain('行业')
    expect(p).toContain('互联网 / 金融')
    expect(p).toContain('禁止新建选项')
    expect(p).toContain('公司、职位')
    expect(p).toContain('按公司推断')
    expect(p).toContain('原样回传每行的 key')
  })
})

describe('inferFills', () => {
  beforeEach(() => mockCreate.mockReset())

  it('parses {fills:[{key,value}]} into a key→value map', async () => {
    reply(JSON.stringify({ fills: [{ key: 'r0', value: '金融' }] }))
    expect((await inferFills(settings, input)).get('r0')).toBe('金融')
  })

  it('keeps array values raw (for multi-select coercion downstream)', async () => {
    reply(JSON.stringify({ fills: [{ key: 'r0', value: ['A', 'B'] }] }))
    expect((await inferFills(settings, input)).get('r0')).toEqual(['A', 'B'])
  })

  it('drops entries with empty/missing value or non-string key', async () => {
    reply(JSON.stringify({ fills: [{ key: 'r0', value: '' }, { value: 'x' }, { key: 'r1', value: '金融' }] }))
    const m = await inferFills(settings, input)
    expect(m.has('r0')).toBe(false)
    expect(m.get('r1')).toBe('金融')
    expect(m.size).toBe(1)
  })

  it('strips ```json fences', async () => {
    reply('```json\n{"fills":[{"key":"r0","value":"金融"}]}\n```')
    expect((await inferFills(settings, input)).get('r0')).toBe('金融')
  })

  it('throws on non-JSON output', async () => {
    reply('就是一段普通文字')
    await expect(inferFills(settings, input)).rejects.toThrow(/JSON/)
  })
})
