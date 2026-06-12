/**
 * 端到端「测试数据」验证：用一份合成销售数据，独立算出期望值，校验三个不依赖飞书/大模型的纯能力——
 *   看板(data-viz)：脏单元格解析 → 聚合/分组/排序/topN → ECharts option；规格净化；字段引用
 *   PPT(slides)  ：脏模型输出净化；且 embed 幻灯片复用看板解释器渲染（跨能力组合）
 *   质检(audit)  ：脏问题列表规整（默认值/裁剪/过滤/严重度）
 * 期望值在测试里手算，所以这是真校验而非「不崩就算过」。
 */
import { describe, it, expect } from 'vitest'
import { num, evalAggregate, groupSeries, buildOption, formatValue, actionTemplate } from './dataviz/interpret'
import { validateSpec, referencedFields, type ChartSpec, type DashboardSpec } from './dataviz/spec'
import { sanitizeSlides } from './ai/slides'
import { normalizeAuditIssues } from './ai/docaudit'

// ── 合成数据：一张销售表（含脏单元格：货币符/千分位/百分比/坏值）──────────────────────
type Row = Record<string, string>
const SALES: Row[] = [
  { 地区: '华东', 类别: '手机', 金额: '¥1,200', 日期: '2024-01', 状态: '已完成' },
  { 地区: '华东', 类别: '手机', 金额: '800', 日期: '2024-02', 状态: '已完成' },
  { 地区: '华北', 类别: '电脑', 金额: '¥3,000', 日期: '2024-01', 状态: '进行中' },
  { 地区: '华南', 类别: '手机', 金额: '500', 日期: '2024-03', 状态: '已完成' },
  { 地区: '华北', 类别: '配件', 金额: '¥150', 日期: '2024-02', 状态: '已完成' },
  { 地区: '华东', 类别: '电脑', 金额: '2,000', 日期: '2024-03', 状态: '进行中' },
  { 地区: '华南', 类别: '配件', 金额: '坏数据', 日期: '2024-01', 状态: '已完成' }, // 非数值 → 不计入求和/均值
]
// 手算期望：手机 1200+800+500=2500；电脑 3000+2000=5000；配件 150（坏数据排除）
// 总额 7650；数值行 6 条 → 均值 1275；已完成 5 行；地区去重 3

describe('看板 data-viz：合成数据端到端（聚合 → option）', () => {
  it('num() 容错解析脏单元格，非数值返回 NaN（被排除而非算成垃圾）', () => {
    expect(num('¥1,200')).toBe(1200)
    expect(num('800')).toBe(800)
    expect(num('85%')).toBe(85)
    expect(Number.isNaN(num(''))).toBe(true)
    expect(Number.isNaN(num('2024-01'))).toBe(true) // 日期不是数
    expect(Number.isNaN(num('坏数据'))).toBe(true)
  })

  it('evalAggregate：各算子 + where 过滤，结果与手算一致', () => {
    expect(evalAggregate(SALES, { op: 'sum', field: '金额' })).toBe(7650)
    expect(evalAggregate(SALES, { op: 'count' })).toBe(7)
    expect(evalAggregate(SALES, { op: 'countDistinct', field: '地区' })).toBe(3)
    expect(evalAggregate(SALES, { op: 'avg', field: '金额' })).toBe(1275)
    expect(evalAggregate(SALES, { op: 'count', where: [{ field: '状态', op: 'eq', value: '已完成' }] })).toBe(5)
    expect(evalAggregate(SALES, { op: 'sum', field: '金额', where: [{ field: '类别', op: 'eq', value: '手机' }] })).toBe(2500)
  })

  it('groupSeries：分组聚合 + 降序 + topN', () => {
    const byCat = groupSeries(SALES, { dimension: '类别', measure: { op: 'sum', field: '金额' }, sort: 'value-desc' })
    expect(byCat).toEqual([{ label: '电脑', value: 5000 }, { label: '手机', value: 2500 }, { label: '配件', value: 150 }])
    const top1 = groupSeries(SALES, { dimension: '类别', measure: { op: 'sum', field: '金额' }, sort: 'value-desc', limit: 1 })
    expect(top1).toEqual([{ label: '电脑', value: 5000 }])
  })

  it('buildOption 柱状图：series.data 与 xAxis 标签正确', () => {
    const spec: ChartSpec = { kind: 'chart', chartType: 'bar', title: '按类别销售额', series: { dimension: '类别', measure: { op: 'sum', field: '金额' }, sort: 'value-desc' } }
    const opt = buildOption(SALES, spec) as { series: Array<{ type: string; data: number[] }>; xAxis: { data: string[] } }
    expect(opt.series[0].type).toBe('bar')
    expect(opt.series[0].data).toEqual([5000, 2500, 150])
    expect(opt.xAxis.data).toEqual(['电脑', '手机', '配件'])
  })

  it('buildOption 饼图：data 为 {name,value}，按地区计数', () => {
    const spec: ChartSpec = { kind: 'chart', chartType: 'pie', series: { dimension: '地区', measure: { op: 'count' }, sort: 'value-desc' } }
    const opt = buildOption(SALES, spec) as { series: Array<{ type: string; data: Array<{ name: string; value: number }> }> }
    expect(opt.series[0].type).toBe('pie')
    expect(opt.series[0].data[0]).toEqual({ name: '华东', value: 3 })
  })

  it('formatValue：KPI 格式化', () => {
    expect(formatValue(7650, 'currency')).toBe('¥7,650')
    expect(formatValue(1275, 'int')).toBe('1,275')
    expect(formatValue(85, 'percent')).toBe('85.0%')
  })

  it('validateSpec：净化脏/幻觉规格（坏算子→count、坏图型→bar、limit 钳制、非串标题丢弃）', () => {
    const messy = {
      kind: 'dashboard', title: 123,
      filters: ['地区'],
      kpis: [{ label: '总额', value: { op: 'TOTAL', field: '金额' } }],
      charts: [{ kind: 'chart', chartType: 'donut', series: { dimension: '类别', measure: { op: 'sum', field: '金额' }, limit: 9999 } }],
    }
    const v = validateSpec(messy) as DashboardSpec
    expect(v.kind).toBe('dashboard')
    expect(v.title).toBeUndefined()
    expect(v.kpis![0].value.op).toBe('count')          // TOTAL 非法 → count
    const c0 = v.charts![0] as ChartSpec
    expect(c0.chartType).toBe('bar')                    // donut 非法 → bar
    expect(c0.series.limit).toBe(200)                   // 9999 钳到 200
  })

  it('referencedFields：收集规格引用到的字段（用于提示幻觉字段）', () => {
    const dash: DashboardSpec = {
      kind: 'dashboard', filters: ['地区'],
      kpis: [{ label: '总额', value: { op: 'sum', field: '金额' } }],
      charts: [{ kind: 'chart', chartType: 'bar', series: { dimension: '类别', measure: { op: 'count' } } }],
    }
    expect(new Set(referencedFields(dash))).toEqual(new Set(['地区', '金额', '类别']))
  })

  it('actionTemplate：行级操作标题模板渲染', () => {
    expect(actionTemplate(SALES[0], '查看 {类别} 在 {地区} 的订单')).toBe('查看 手机 在 华东 的订单')
  })
})

describe('PPT slides：净化脏输出 + 嵌入看板复用解释器', () => {
  it('sanitizeSlides：坏布局→bullets、要点≤7、标题≤120、空页丢弃、stats 规整', () => {
    const raw = [
      { layout: 'title', title: '封面', subtitle: '副标题' },
      { layout: '不存在', bullets: ['1', '2', '3', '4', '5', '6', '7', '8', '9'] }, // →bullets，9→7
      { title: 'T'.repeat(200), bullets: [1, 2, 3] },                                // 无 layout→bullets；标题→120；数字要点→字符串
      null,                                                                          // 跳过
      {},                                                                            // 空 → 丢弃
      { layout: 'stats', stats: [{ num: 123, label: '营收' }, { num: '42%' }, { num: 'a' }, { num: 'b' }, { num: 'c' }, { num: 'd' }, { num: 'e' }] }, // 7→6，num 转串
      { layout: 'quote', quote: 'Q'.repeat(500), by: '作者' },                        // 引言→400
    ]
    const out = sanitizeSlides(raw)
    expect(out.length).toBe(5)                          // 跳过 null + 丢弃空页
    expect(out[1].layout).toBe('bullets')
    expect(out[1].bullets!.length).toBe(7)
    expect(out[2].title!.length).toBe(120)
    expect(out[2].bullets).toEqual(['1', '2', '3'])
    expect(out[3].stats!.length).toBe(6)
    expect(out[3].stats![0]).toEqual({ num: '123', label: '营收' })
    expect(out[4].quote!.length).toBe(400)
  })

  it('sanitizeSlides：整套 deck 上限 40 张', () => {
    const big = Array.from({ length: 45 }, (_, i) => ({ layout: 'section', title: '章节' + i }))
    expect(sanitizeSlides(big).length).toBe(40)
  })

  it('跨能力：embed 幻灯片携带 VizSpec → 被保留 → 用看板解释器对同一数据渲染', () => {
    const board: ChartSpec = { kind: 'chart', chartType: 'bar', series: { dimension: '类别', measure: { op: 'sum', field: '金额' }, sort: 'value-desc' } }
    const deck = sanitizeSlides([{ layout: 'embed', spec: board }, { layout: 'title', title: '封面' }])
    const embed = deck.find((s) => s.layout === 'embed')
    expect(embed?.spec).toBeTruthy()                                       // Plan-B spec 被保留
    const opt = buildOption(SALES, embed!.spec as ChartSpec) as { series: Array<{ data: number[] }> }
    expect(opt.series[0].data).toEqual([5000, 2500, 150])                  // 嵌入看板渲染出正确聚合
  })
})

describe('质检 doc audit：脏问题列表规整', () => {
  it('normalizeAuditIssues：默认值 / 裁剪 / 过滤无内容 / 严重度兜底', () => {
    // 故意混入脏数据（非法 severity、null），用 unknown 绕过类型再交给被测函数容错。
    const dirty: unknown[] = [
      { type: '逻辑', severity: 'high', quote: 'q1', problem: 'p1', suggestion: 's1' },
      { problem: '只有 problem 也保留' },                                   // type→其它，severity→medium
      { quote: '只有 quote 也保留' },
      { severity: 'critical', problem: '坏严重度→medium' },                 // 非法 severity → medium
      { type: '类型名超长'.repeat(10), problem: 'p', quote: 'q' },          // type 裁到 16
      { suggestion: '只有建议' },                                          // 无 problem 无 quote → 过滤
      null,                                                              // 过滤
      { problem: 'P'.repeat(500) },                                       // problem 裁到 300
    ]
    const out = normalizeAuditIssues({ issues: dirty } as unknown as Parameters<typeof normalizeAuditIssues>[0])
    expect(out.length).toBe(6)
    expect(out[1].type).toBe('其它')
    expect(out[1].severity).toBe('medium')
    expect(out[3].severity).toBe('medium')
    expect(out[4].type.length).toBe(16)
    expect(out[5].problem.length).toBe(300)
  })

  it('normalizeAuditIssues：空 / null 输入 → []', () => {
    expect(normalizeAuditIssues({ issues: [] })).toEqual([])
    expect(normalizeAuditIssues({})).toEqual([])
    expect(normalizeAuditIssues(null)).toEqual([])
  })
})
