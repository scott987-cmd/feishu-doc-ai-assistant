import OpenAI from 'openai'
import type { AppSettings } from '../types'
import { assertSafeBaseUrl } from '../providers'
import { BUILD_CONFIG } from '../config'
import { TYPE_LABEL } from '../smartfill/coerce'
import type { FillField } from '../smartfill/types'
import { stripFences } from './text'
import { resolveLlmConfig } from './llmConfig'
import { redactSensitive } from './redact'

/**
 * One-shot inference: given a target field, a few already-filled example rows, and a
 * batch of empty rows (each carrying a STABLE key), ask the LLM for the value of each
 * row's target cell. Returns a Map<rowKey, rawValue> — the caller joins keys back to
 * record IDs (the model never sees record IDs, and order is never trusted). Same client
 * / egress / guard as dataviz.ts; the value is structured data, so no sandbox is needed.
 */

export interface InferRow {
  key: string
  cells: Record<string, string>
}

export interface InferInput {
  field: FillField
  sourceFields: string[]
  examples: Array<Record<string, string>>
  rows: InferRow[]
  instruction: string
}

export function buildPrompt(input: InferInput): string {
  const { field, sourceFields, examples, rows, instruction } = input
  const isSelect = field.type === 3 || field.type === 4
  const typeLine = isSelect && field.options?.length
    ? `（${field.type === 4 ? '多选' : '单选'}；value 只能从这些选项里选，禁止新建选项：${field.options.join(' / ')}）`
    : `（类型：${TYPE_LABEL[field.type] ?? `type_${field.type}`}）`
  return (
    `你是表格智能填充助手。根据每一行的已知字段，推断出【目标字段】的值。\n` +
    `【目标字段】${field.name}${typeLine}\n` +
    `【可参考字段】${sourceFields.join('、') || '（所有其它列）'}\n` +
    (instruction ? `【填充说明】${instruction}\n` : '') +
    (examples.length ? `【已填示例（学习填法，不要修改它们）】\n${JSON.stringify(examples)}\n` : '') +
    `【需要填充的行（必须原样回传每行的 key，禁止改 key）】\n${redactSensitive(JSON.stringify(rows))}\n` +
    `【输出】严格只输出一个 JSON 对象：{"fills":[{"key":"<行 key>","value":<填充值>}, ...]}。\n` +
    `规则：① value 用目标字段类型的原生值——数字给数字、日期给 "YYYY-MM-DD" 字符串、多选给字符串数组、` +
    `单选/多选必须是上面给定的选项之一；② 不确定的行直接省略（绝不编造、不要写空字符串）；` +
    `③ 不要输出任何解释、前言或代码围栏，只要那个 JSON 对象。`
  )
}

export async function inferFills(settings: AppSettings, input: InferInput): Promise<Map<string, unknown>> {
  const cfg = await resolveLlmConfig(settings)
  const baseURL = assertSafeBaseUrl(cfg.baseUrl, BUILD_CONFIG.openaiAllowedHosts)
  const client = new OpenAI({ baseURL, apiKey: cfg.apiKey, dangerouslyAllowBrowser: true })
  const resp = await client.chat.completions.create({
    model: cfg.model,
    stream: false,
    messages: [{ role: 'user', content: buildPrompt(input) }],
  })
  let out = (resp.choices[0]?.message?.content ?? '').trim()
  if (!out) throw new Error('模型未返回内容。')
  out = stripFences(out)
  let parsed: { fills?: Array<{ key?: unknown; value?: unknown }> }
  try {
    parsed = JSON.parse(out)
  } catch {
    throw new Error('模型输出不是有效 JSON，无法解析填充结果。请重试或换一个支持 JSON 输出的模型。')
  }
  const map = new Map<string, unknown>()
  for (const f of parsed.fills ?? []) {
    if (f && typeof f.key === 'string' && f.value != null && f.value !== '') map.set(f.key, f.value)
  }
  return map
}
