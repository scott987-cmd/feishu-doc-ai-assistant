import type { AppSettings, PageContext } from '../types'
import { resolveToken } from '../feishu/auth'
import { getDocumentContent } from '../feishu/docx'
import { deriveVizSource, fetchVizData } from '../dataviz/data'
import { loadVizList } from '../dataviz/store'
import { vizMatchesCtx } from '../dataviz/scope'
import type { VizField, VizSource } from '../dataviz/types'
import { stripFences as fences } from './text'
import { sanitizeForLlm } from './redact'
import { chatCompleteStream } from './llm'
import { NO_REMOTE_CODE } from '../config'

/**
 * 文档转 PPT / AI 幻灯片 — read a Feishu doc, summarize it, and structure it into a multi-page
 * slide deck. The model returns only CONTENT (per-slide titles/bullets/…); the sandbox's reliable
 * `ui.slides` helper renders the paged presentation. One LLM call summarizes AND slidifies, so it's
 * fast ("快速生成"). Read-only; the produced artifact is the slides JSON.
 */

/** One slide. `layout` picks how the sandbox renders it; fields are content the model fills. */
export interface Slide {
  layout?: 'title' | 'section' | 'bullets' | 'two-col' | 'quote' | 'stats' | 'chart' | 'embed'
  title?: string
  subtitle?: string
  bullets?: string[]
  bullets2?: string[]
  quote?: string
  by?: string
  stats?: Array<{ num?: string; label?: string }>
  /** layout:'chart' — a self-contained ECharts option (numbers embedded; rendered via ui.chart). */
  chart?: Record<string, unknown>
  /** layout:'embed' — a saved 看板/小程序's render code, re-run live against the table's rows. */
  code?: string
  /** layout:'embed' — Plan B: a saved board's declarative spec (no-remote-code builds). */
  spec?: import('../dataviz/spec').VizSpec
}

const MAX_CHARS = 16000

function buildSlidesPrompt(docText: string, request?: string): string {
  return (
    `你是顶尖的演示设计师。通读下面这篇飞书文档，先在心里把它总结清楚，再把它做成一套【可翻页的幻灯片 PPT】。\n` +
    `输出一个 JSON 对象：{"title":"演示标题","slides":[ 每张幻灯片一个对象 ]}。按内容给每张选 layout：\n` +
    `  · {"layout":"title","title":"主标题","subtitle":"副标题/一句话主旨"} —— 仅第 1 张封面用\n` +
    `  · {"layout":"section","title":"章节名","subtitle":"可选小字"} —— 章节分隔页\n` +
    `  · {"layout":"bullets","title":"小标题","bullets":["要点1","要点2",...]} —— 最常用，每页 3–6 条、每条一句话\n` +
    `  · {"layout":"two-col","title":"小标题","bullets":[...],"bullets2":[...]} —— 对比 / 前后 / 优缺点\n` +
    `  · {"layout":"stats","title":"小标题","stats":[{"num":"42%","label":"说明"},...]} —— 关键数字（仅当原文确有该数字）\n` +
    `  · {"layout":"chart","title":"小标题","chart":{完整 ECharts 配置对象}} —— **当原文出现一组数据指标 / 占比 / 趋势 / 排名时，优先用图表呈现**，这样更像真正的 PPT。chart 必须是自包含的 ECharts option（数字直接写进 series.data，类目写进 xAxis.data 或 pie 的 name）；图表类型只用 bar / line / pie / scatter；不要设 backgroundColor；**只用原文确有的数字、绝不编造**。\n` +
    `  · {"layout":"quote","quote":"金句/结论原话","by":"出处(可选)"} —— 重点结论 / 收尾\n` +
    `【要求】8–16 张；第 1 张必须是 title 封面；忠实概括原文、**绝不编造**数字或事实；文字精炼（标题≤20 字、要点≤30 字）；用中文；按逻辑分章。\n` +
    (request?.trim() ? `【用户额外要求】${request.trim()}\n` : '') +
    `只输出那个 JSON 对象本身，不要任何解释、前言或代码围栏。\n\n【文档内容】\n${docText}`
  )
}

const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x ?? '')).filter((s) => s.trim()).slice(0, 7) : [] // ≤7 bullets/page

/** Coerce model output into safe, well-formed slides (ui.slides also tolerates gaps, but trim here). */
export function sanitizeSlides(raw: unknown): Slide[] {
  if (!Array.isArray(raw)) return []
  const out: Slide[] = []
  for (const r0 of raw) {
    if (!r0 || typeof r0 !== 'object') continue
    const r = r0 as Record<string, unknown>
    const layout = (['title', 'section', 'bullets', 'two-col', 'quote', 'stats', 'chart', 'embed'] as const)
      .find((l) => l === r.layout) ?? 'bullets'
    const s: Slide = { layout }
    if (typeof r.title === 'string') s.title = r.title.slice(0, 120)
    if (typeof r.subtitle === 'string') s.subtitle = r.subtitle.slice(0, 200)
    if (typeof r.quote === 'string') s.quote = r.quote.slice(0, 400)
    if (typeof r.by === 'string') s.by = r.by.slice(0, 80)
    if (r.bullets) s.bullets = arr(r.bullets)
    if (r.bullets2) s.bullets2 = arr(r.bullets2)
    if (Array.isArray(r.stats)) {
      s.stats = (r.stats as unknown[]).slice(0, 6).map((t) => {
        const o = (t ?? {}) as Record<string, unknown>
        return { num: String(o.num ?? '').slice(0, 24), label: String(o.label ?? '').slice(0, 60) }
      })
    }
    // A chart slide carries a self-contained ECharts option object (data inside).
    if (layout === 'chart' && r.chart && typeof r.chart === 'object') s.chart = r.chart as Record<string, unknown>
    // An embed slide carries a saved 看板's render code, OR (no-remote-code / Plan B) a declarative
    // VizSpec rendered by the bundled interpreter. Preserve whichever is present so a deck survives
    // re-sanitisation without losing its embedded board.
    if (layout === 'embed' && typeof r.code === 'string') s.code = r.code
    if (layout === 'embed' && r.spec && typeof r.spec === 'object') s.spec = r.spec as Slide['spec']
    // Drop empty/no-content slides (nothing to show).
    if (s.title || s.subtitle || s.quote || s.bullets?.length || s.bullets2?.length || s.stats?.length || s.chart || s.code || s.spec) out.push(s)
  }
  return out.slice(0, 40)
}

export async function generateSlides(
  settings: AppSettings,
  input: { docText: string; request?: string; signal?: AbortSignal; onProgress?: (chars: number) => void },
): Promise<{ name: string; slides: Slide[] }> {
  const out = fences(await chatCompleteStream(settings, buildSlidesPrompt(input.docText, input.request), {
    signal: input.signal, onChunk: (f) => input.onProgress?.(f.length),
  }))
  if (!out) throw new Error('模型未返回内容。')
  let parsed: { title?: string; slides?: unknown }
  try { parsed = JSON.parse(out) } catch { throw new Error('幻灯片解析失败，请重试或换一个支持 JSON 输出的模型。') }
  const slides = sanitizeSlides(parsed.slides)
  if (!slides.length) throw new Error('没有生成可用的幻灯片内容。')
  return { name: String(parsed.title || '演示').slice(0, 40), slides }
}

/** Adjust ONE slide per a natural-language instruction (e.g. "这页改成饼图" / "精简为 3 条"). The
 *  model returns the revised single slide; the rest of the deck is untouched. */
export async function adjustSlide(
  settings: AppSettings,
  input: { slide: Slide; instruction: string; signal?: AbortSignal },
): Promise<Slide> {
  const content =
    `下面是一套演示里的【某一页幻灯片】(JSON)。请按【调整要求】只修改这一页，保持信息忠实、不要编造。\n` +
    `可选 layout：title / section / bullets / two-col / quote / stats / chart；字段：title、subtitle、bullets[]、bullets2[]、quote、by、stats[{num,label}]、chart(自包含 ECharts 配置对象)。\n` +
    `可以改 layout、文字、要点，或把数据这页改成 chart（图表）。文字精炼（标题≤20 字、要点≤30 字）。\n` +
    `只输出修改后的【单个幻灯片 JSON 对象】，不要数组、不要解释、不要代码围栏。\n` +
    `【当前这页】\n${JSON.stringify(input.slide)}\n【调整要求】${input.instruction}`
  const out = fences(await chatCompleteStream(settings, content, { signal: input.signal }))
  if (!out) throw new Error('模型未返回内容。')
  let parsed: unknown
  try { parsed = JSON.parse(out) } catch { throw new Error('调整结果解析失败，请重试或换种说法。') }
  const [s] = sanitizeSlides([parsed])
  if (!s) throw new Error('调整后这页没有可用内容，请换种说法重试。')
  return s
}

export interface SlidesResult {
  name: string
  slides: Slide[]
  truncated: boolean
  /** Set for a table deck → lets the panel re-fetch rows for embed (看板) slides on reopen. */
  source?: VizSource
  /** Live rows to drive embed (看板) slides for the current render (not persisted; re-fetched on reopen). */
  rows?: Record<string, string>[]
}

/** Read the current doc's text and turn it into a slide deck. */
export async function runDocToSlides(
  settings: AppSettings,
  documentId: string,
  request?: string,
  opts?: { signal?: AbortSignal; onProgress?: (chars: number) => void },
): Promise<SlidesResult> {
  const token = await resolveToken(settings)
  const res = (await getDocumentContent(token, documentId)) as { content?: string }
  const full = (res.content ?? '').trim()
  if (!full) throw new Error('这篇文档没有可读取的内容。')
  const text = full.slice(0, MAX_CHARS)
  const { name, slides } = await generateSlides(settings, { docText: text, request, signal: opts?.signal, onProgress: opts?.onProgress })
  return { name, slides, truncated: full.length > MAX_CHARS }
}

// ─── 多维表格 / 电子表格 → PPT ────────────────────────────────────────────────

const fieldList = (schema: VizField[]) =>
  schema.map((f) => `${f.name}（${f.type}）${f.samples?.length ? `｜样本: ${f.samples.join(', ')}` : ''}`).join('\n')

const DATA_SAMPLE_CAP = 150

function buildDataSlidesPrompt(schema: VizField[], sampleRows: Record<string, string>[], request?: string): string {
  return (
    `你是顶尖的演示设计师 + 数据分析师。把下面这张表（飞书多维表格 / 电子表格）做成一套【可翻页的幻灯片 PPT】，向他人汇报这张表的内容与发现。\n` +
    `输出一个 JSON 对象：{"title":"演示标题","slides":[ 每张幻灯片一个对象 ]}。按内容给每张选 layout：\n` +
    `  · {"layout":"title","title":"主标题","subtitle":"一句话主旨"} —— 仅第 1 张封面\n` +
    `  · {"layout":"section","title":"章节名","subtitle":"可选小字"} —— 章节分隔\n` +
    `  · {"layout":"bullets","title":"小标题","bullets":["要点",...]} —— 概览 / 维度说明 / 发现，每页 3–6 条\n` +
    `  · {"layout":"two-col","title":"小标题","bullets":[...],"bullets2":[...]} —— 对比 / 分组\n` +
    `  · {"layout":"stats","title":"小标题","stats":[{"num":"123","label":"说明"},...]} —— 关键数字\n` +
    `  · {"layout":"chart","title":"小标题","chart":{完整 ECharts 配置对象}} —— **数据维度优先用图表展示**（分布/占比→饼或柱、趋势→折线、排名→条形），这样才像真正的 PPT。chart 必须是自包含 ECharts option：把从【样本数据】里数出来 / 算出来的数字直接写进 series.data，类目写进 xAxis.data 或 pie 的 name；类型只用 bar / line / pie / scatter；不设 backgroundColor。\n` +
    `  · {"layout":"quote","quote":"结论","by":"可选"} —— 重点结论 / 建议收尾\n` +
    `【内容建议】封面 → 这张表在跟踪什么（字段含义）→ **用 1–3 张 chart 展示主要分布 / 占比 / 排名 / 趋势** → 值得注意的模式 → 结论 / 建议。\n` +
    `【诚实硬规则】**只用下面【样本数据】里能直接数出来 / 算出来的数字**；样本可能不是全部行，凡涉及数量请措辞为「样本中…」，**绝不编造精确总数或比例**；只用真实存在的字段名；不确定的用定性要点而非假数字。\n` +
    `【要求】8–14 张；第 1 张必须是 title 封面；文字精炼（标题≤20 字、要点≤30 字）；中文。\n` +
    (request?.trim() ? `【用户额外要求】${request.trim()}\n` : '') +
    `只输出那个 JSON 对象本身，不要任何解释、前言或代码围栏。\n\n【字段】\n${fieldList(schema)}\n\n【样本数据（前 ${sampleRows.length} 行）】\n${sanitizeForLlm(JSON.stringify(sampleRows))}`
  )
}

export async function generateSlidesFromData(
  settings: AppSettings,
  input: { schema: VizField[]; sampleRows: Record<string, string>[]; request?: string; signal?: AbortSignal; onProgress?: (chars: number) => void },
): Promise<{ name: string; slides: Slide[] }> {
  const out = fences(await chatCompleteStream(settings, buildDataSlidesPrompt(input.schema, input.sampleRows, input.request), {
    signal: input.signal, onChunk: (f) => input.onProgress?.(f.length),
  }))
  if (!out) throw new Error('模型未返回内容。')
  let parsed: { title?: string; slides?: unknown }
  try { parsed = JSON.parse(out) } catch { throw new Error('幻灯片解析失败，请重试或换一个支持 JSON 输出的模型。') }
  const slides = sanitizeSlides(parsed.slides)
  if (!slides.length) throw new Error('没有生成可用的幻灯片内容。')
  return { name: String(parsed.title || '数据演示').slice(0, 40), slides }
}

const TABLE_ROWS_CAP = 1000

/** Saved 看板/小程序 (dashboards) for the resource now in view → embed slides reusing them. */
export async function savedDashboardEmbeds(feishu: NonNullable<PageContext['feishu']>): Promise<Slide[]> {
  const list = await loadVizList()
  return list
    // In no-remote-code builds an embed can only render from a spec — drop legacy code-only boards.
    .filter((v) => v.kind !== 'site' && vizMatchesCtx(v.source, feishu) && (!NO_REMOTE_CODE || v.spec))
    .slice(0, 4)
    .map((v) => ({ layout: 'embed' as const, title: v.name, code: v.code, spec: v.spec }))
}

/** Read the current Base/Sheet table and turn it into a slide deck. Appends the user's saved 看板
 *  for this table as embed slides (reusing dashboards), and returns rows to drive them. */
export async function runTableToSlides(
  settings: AppSettings,
  feishu: NonNullable<PageContext['feishu']>,
  request?: string,
  opts?: { signal?: AbortSignal; onProgress?: (chars: number) => void },
): Promise<SlidesResult> {
  const source = await deriveVizSource(settings, feishu)
  if (!source) throw new Error('无法识别当前表，请打开一个多维表格或电子表格。')
  const { schema, rows } = await fetchVizData(settings, source, TABLE_ROWS_CAP)
  if (!schema.length) throw new Error('这张表没有可用的字段。')
  const { name, slides } = await generateSlidesFromData(settings, {
    schema, sampleRows: rows.slice(0, DATA_SAMPLE_CAP), request, signal: opts?.signal, onProgress: opts?.onProgress,
  })
  const embeds = await savedDashboardEmbeds(feishu) // 复用已保存的看板
  return { name, slides: [...slides, ...embeds], source, rows, truncated: rows.length >= TABLE_ROWS_CAP }
}
