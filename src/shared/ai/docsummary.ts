import type { AppSettings } from '../types'
import { resolveToken } from '../feishu/auth'
import { getDocumentContent } from '../feishu/docx'
import { chatComplete } from './llm'
import { stripFences } from './text'

/**
 * 文档总结 / Doc summary — read the whole document and summarize it. The SUMMARY PROMPT is
 * fully user-editable (persisted, surfaced in the panel) so you control what kind of summary
 * you get; Feishu's native AI 速览 is fixed. Read-only; returns the summary text (markdown).
 */

export interface SummaryResult {
  summary: string
  charsScanned: number
  truncated: boolean
}

const MAX_CHARS = 16000

/** The default summary instruction — USER-EDITABLE (persisted; surfaced in the panel). */
export const DEFAULT_SUMMARY_PROMPT =
  '用简洁、客观的中文总结这篇文档：\n' +
  '1）先用 2–4 句话概括核心内容；\n' +
  '2）再用「要点」分条列出关键信息（3–8 条）；\n' +
  '3）若文中有明确的待办 / 决议 / 负责人 / 截止时间，单独列出。\n' +
  '只基于原文，不要编造；不确定的不写。'

const PROMPT_KEY = 'docsummary_prompt_v1'

export async function loadSummaryPrompt(): Promise<string> {
  try {
    const r = await chrome.storage.local.get([PROMPT_KEY])
    const v = r?.[PROMPT_KEY]
    return typeof v === 'string' && v.trim() ? v : DEFAULT_SUMMARY_PROMPT
  } catch { return DEFAULT_SUMMARY_PROMPT }
}

export async function saveSummaryPrompt(prompt: string): Promise<void> {
  try { await chrome.storage.local.set({ [PROMPT_KEY]: prompt }) } catch { /* best-effort */ }
}

export async function summarizeDoc(settings: AppSettings, text: string, prompt: string = DEFAULT_SUMMARY_PROMPT): Promise<string> {
  const content =
    `${prompt.trim()}\n\n（严格只基于下面的文档内容，不要编造；用 markdown 输出，不要代码围栏。）\n【文档内容】\n${text}`
  const out = (await chatComplete(settings, content)).trim()
  if (!out) throw new Error('模型未返回内容。')
  return stripFences(out)
}

/** Read the current doc's text and summarize it. `prompt` defaults to the user's saved one. */
export async function runDocSummary(settings: AppSettings, documentId: string, prompt?: string): Promise<SummaryResult> {
  const token = await resolveToken(settings)
  const res = (await getDocumentContent(token, documentId)) as { content?: string }
  const full = (res.content ?? '').trim()
  if (!full) throw new Error('这篇文档没有可读取的内容。')
  const text = full.slice(0, MAX_CHARS)
  const summary = await summarizeDoc(settings, text, prompt ?? (await loadSummaryPrompt()))
  return { summary, charsScanned: text.length, truncated: full.length > MAX_CHARS }
}
