import OpenAI from 'openai'
import type { AppSettings } from '../types'
import { assertSafeBaseUrl } from '../providers'
import { BUILD_CONFIG } from '../config'
import { resolveLlmConfig } from './llmConfig'

/**
 * One-shot vision call: hand a screenshot to the configured (vision-capable) LLM and get
 * back a clean Markdown table (or readable text). Used by the Web Clipper's screenshot path
 * for pages whose table is <canvas>/image-rendered and has no DOM text.
 *
 * Security: identical trust boundary to the text path — the image is POSTed only to the
 * already-configured LLM host (guarded by assertSafeBaseUrl + openaiAllowedHosts). No new
 * egress, no new permission.
 */

const VISION_PROMPT =
  '你是一个表格识别助手。下面给你一张网页截图，请从中提取数据：\n' +
  '- 如果图中包含表格/数据网格：把它转成一个干净规整的 Markdown 表格（第一行表头，每行一条数据，' +
  '列与列用 | 分隔），保持行列完整，不要合并或漏掉任何一行。\n' +
  '- 如果图中没有表格、只有正文文字：原样输出可读的文字内容。\n' +
  '- 只输出图片里实际存在的内容，绝对不要编造、补全或推测任何数据。\n' +
  '- 直接输出结果本身（Markdown 表格或文字），不要加任何解释、前言或代码围栏。'

/** Map a provider's "this model can't take images" error to a friendly, actionable message. */
export function isVisionUnsupportedError(message: string): boolean {
  return /image|multimodal|vision|content.*type|unsupported|invalid.*content|400/i.test(message)
}

export async function imageToMarkdown(settings: AppSettings, dataUrl: string): Promise<string> {
  const cfg = await resolveLlmConfig(settings)
  const baseURL = assertSafeBaseUrl(cfg.baseUrl, BUILD_CONFIG.openaiAllowedHosts)
  const client = new OpenAI({ baseURL, apiKey: cfg.apiKey, dangerouslyAllowBrowser: true })
  try {
    const resp = await client.chat.completions.create({
      model: cfg.model,
      stream: false,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: VISION_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    })
    const out = resp.choices[0]?.message?.content?.trim() ?? ''
    if (!out) throw new Error('模型未返回内容。')
    return out
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (isVisionUnsupportedError(msg)) {
      throw new Error('当前大模型不支持图片识别，请在「设置」里配置支持视觉的模型（如 GPT-4o / Qwen-VL / GLM-4V 等）。')
    }
    throw e instanceof Error ? e : new Error(msg)
  }
}
