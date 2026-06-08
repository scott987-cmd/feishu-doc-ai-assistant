import type { AppSettings } from '../types'
import type { VizField } from '../dataviz/types'
import type { TableProfile } from '../report/types'
import { chatComplete } from './llm'
import { stripFences } from './text'
import { sanitizeForLlm } from './redact'

/**
 * Ask the LLM for a narrative analysis report (markdown body + a title) from the table's
 * schema + compact profile + a small sample. Same client/guard/egress as dataviz.ts. The
 * body is markdown rendered by markdownToBlocks (headings/lists only) — the model is told
 * NOT to emit markdown tables or code blocks (the data table is inserted separately).
 */
export interface ReportInput {
  schema: VizField[]
  profile: TableProfile
  sampleRows: Record<string, string>[]
  focus?: string
  sourceKind: 'base' | 'sheet'
}

function buildPrompt(input: ReportInput): string {
  const schemaText = input.schema.map((f) => `${f.name}（${f.type}）`).join('、')
  return (
    `你是资深数据分析师。基于下面这张${input.sourceKind === 'base' ? '多维表格' : '电子表格'}的数据，写一篇简洁、专业的【分析报告】。\n` +
    `输出一个 JSON 对象：{"title":"简短标题(≤20字)","markdown":"报告正文(markdown)"}。\n` +
    `正文结构（用 ## 分节、- 列表）：\n` +
    `## 摘要（2-4 句给结论）\n## 关键发现（3-6 条，每条结合【统计摘要】里的真实数字）\n` +
    `## 趋势与异常（基于数据；没有就写"暂未发现明显异常"）\n## 建议（2-4 条，可执行）\n` +
    `硬规则：① 只用给定数据，**绝不编造数字或字段**；② 数字尽量直接引用【统计摘要】；` +
    `③ **不要用 markdown 表格语法（| |）、不要用代码块**（源数据表会自动附在文末）；` +
    `④ 客观中肯、不堆砌形容词；⑤ 只输出那个 JSON 对象本身，不要解释、前言或代码围栏。\n` +
    (input.focus ? `【分析重点】${input.focus}\n` : '') +
    `【共 ${input.profile.rowCount} 行】【字段】${schemaText}\n` +
    `【统计摘要】\n${JSON.stringify(input.profile.fields)}\n` +
    `【样本数据（前 ${input.sampleRows.length} 行）】\n${sanitizeForLlm(JSON.stringify(input.sampleRows))}`
  )
}

export async function generateReport(settings: AppSettings, input: ReportInput): Promise<{ title: string; markdown: string }> {
  let out = (await chatComplete(settings, buildPrompt(input))).trim()
  if (!out) throw new Error('模型未返回内容。')
  out = stripFences(out)
  let parsed: { title?: string; markdown?: string }
  try {
    parsed = JSON.parse(out)
  } catch {
    throw new Error('模型输出不是有效 JSON，无法生成报告。请重试或换一个支持 JSON 输出的模型。')
  }
  const markdown = (parsed.markdown ?? '').trim()
  if (!markdown) throw new Error('模型没有生成报告正文。')
  const title = (parsed.title || input.focus || '数据分析报告').slice(0, 40)
  return { title, markdown }
}
