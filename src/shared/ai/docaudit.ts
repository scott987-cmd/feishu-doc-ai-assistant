import type { AppSettings } from '../types'
import { resolveToken } from '../feishu/auth'
import { getDocumentContent } from '../feishu/docx'
import { chatComplete } from './llm'
import { stripFences } from './text'

/**
 * 文档体检 / Doc audit — read the whole document and have the LLM surface real quality
 * problems (logic gaps, undefined terms, contradictions, leftover TODOs, stale data, empty
 * sections). Read-only; returns a structured issue list (no writes). Same client/guard/egress
 * as the other AI calls. This is the document analog of compose.ts `auditTable` (Base audit).
 */

export interface AuditIssue {
  type: string                              // 逻辑 / 术语 / 矛盾 / TODO / 过期 / 空小节 / 其它
  severity: 'high' | 'medium' | 'low'
  quote: string                             // a short quote of the offending text (to locate it)
  problem: string
  suggestion: string
}

export interface AuditResult {
  issues: AuditIssue[]
  charsScanned: number
  truncated: boolean
}

const MAX_CHARS = 16000

/** The default check dimensions — USER-EDITABLE (persisted; surfaced in the panel). The
 *  fixed output contract below is NOT user-editable, so parsing always stays valid. */
export const DEFAULT_AUDIT_CHECK =
  '① 逻辑断点 / 跳跃、论证缺环\n' +
  '② 未定义就使用的术语 / 缩写\n' +
  '③ 前后矛盾（数字、结论、口径不一致）\n' +
  '④ 遗留的 TODO / 待补充 / 占位符（如 XXX、??、待定）\n' +
  '⑤ 可能过期或自相矛盾的数据 / 日期\n' +
  '⑥ 有标题却没有内容的空小节\n' +
  '⑦ 明显的事实 / 拼写错误'

function buildPrompt(text: string, check: string): string {
  return (
    `你是严格、克制的文档审校专家。通读下面整篇文档，只挑出**真正的问题**，分类列出。\n` +
    `按下面的【检查维度】审：\n${check.trim()}\n` +
    `输出一个 JSON 对象：{"issues":[{"type":"问题类别","severity":"high|medium|low",` +
    `"quote":"出问题处的原文片段（≤30字，便于定位）","problem":"问题是什么","suggestion":"怎么改"}]}。\n` +
    `规则：只报有把握的真问题，宁缺毋滥；没把握/主观偏好不要报；若通篇没问题就返回 {"issues":[]}。` +
    `quote 必须是文档里出现过的原文。只输出那个 JSON 对象本身，不要任何解释、前言或代码围栏。\n` +
    `【文档内容】\n${text}`
  )
}

const CHECK_KEY = 'docaudit_check_v1'

/** The user's customized check dimensions (falls back to the default). */
export async function loadAuditCheck(): Promise<string> {
  try {
    const r = await chrome.storage.local.get([CHECK_KEY])
    const v = r?.[CHECK_KEY]
    return typeof v === 'string' && v.trim() ? v : DEFAULT_AUDIT_CHECK
  } catch { return DEFAULT_AUDIT_CHECK }
}

export async function saveAuditCheck(check: string): Promise<void> {
  try { await chrome.storage.local.set({ [CHECK_KEY]: check }) } catch { /* best-effort */ }
}

/** Normalize raw audit issues (from the model's JSON) into the safe, clamped AuditIssue shape.
 *  Pure — drops items with neither problem nor quote, defaults severity to 'medium', clamps
 *  field lengths. Extracted so it can be unit-tested with synthetic data (no LLM). */
export function normalizeAuditIssues(parsed: { issues?: Array<Partial<AuditIssue>> } | null | undefined): AuditIssue[] {
  const sev = (s: unknown): AuditIssue['severity'] => (s === 'high' || s === 'low' ? s : 'medium')
  return (parsed?.issues ?? [])
    .filter((i) => i && (i.problem || i.quote))
    .map((i) => ({
      type: String(i.type ?? '其它').slice(0, 16),
      severity: sev(i.severity),
      quote: String(i.quote ?? '').slice(0, 120),
      problem: String(i.problem ?? '').slice(0, 300),
      suggestion: String(i.suggestion ?? '').slice(0, 300),
    }))
}

export async function auditDocument(settings: AppSettings, text: string, check: string = DEFAULT_AUDIT_CHECK): Promise<AuditIssue[]> {
  let out = (await chatComplete(settings, buildPrompt(text, check))).trim()
  if (!out) throw new Error('模型未返回内容。')
  out = stripFences(out)
  let parsed: { issues?: Array<Partial<AuditIssue>> }
  try {
    parsed = JSON.parse(out)
  } catch {
    throw new Error('模型输出不是有效 JSON，无法生成体检结果。请重试或换一个支持 JSON 输出的模型。')
  }
  return normalizeAuditIssues(parsed)
}

/** Read the current doc's text and run the audit. Caps the text to bound tokens. `check`
 *  defaults to the user's saved check dimensions (so the on-page quick action uses them too). */
export async function runDocAudit(settings: AppSettings, documentId: string, check?: string): Promise<AuditResult> {
  const token = await resolveToken(settings)
  const res = (await getDocumentContent(token, documentId)) as { content?: string }
  const full = (res.content ?? '').trim()
  if (!full) throw new Error('这篇文档没有可读取的内容。')
  const text = full.slice(0, MAX_CHARS)
  const issues = await auditDocument(settings, text, check ?? (await loadAuditCheck()))
  return { issues, charsScanned: text.length, truncated: full.length > MAX_CHARS }
}
