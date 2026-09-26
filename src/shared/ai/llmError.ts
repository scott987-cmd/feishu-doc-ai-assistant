/**
 * Turn an LLM transport failure into an actionable message.
 *
 * The OpenAI SDK reports EVERY fetch-level failure as a bare English "Connection error."
 * (a timeout as "Request timed out."), and a plain fetch() as "Failed to fetch" — the user
 * can't tell a mistyped Base URL from a blocked network or a provider that refuses browser
 * (CORS) calls, because the browser deliberately hides which one it was. So we name the host,
 * list the likely causes, and point at Settings →「测试模型连接」(llmProbe.ts), which can
 * narrow it down.
 *
 * SDK-free on purpose (no `openai` import): llm.ts uses this from the background service
 * worker, where the SDK isn't bundled — SDK errors are recognized structurally instead.
 */

/** The TypeError message fetch() rejects with when no HTTP response arrived (per engine),
 *  incl. a body stream cut mid-way ("network error"). Never an HTTP status error. */
const FETCH_FAILURE = /^(failed to fetch|networkerror when attempting to fetch resource\.?|load failed|network error|fetch failed)$/i

export type LlmFailureKind = 'network' | 'timeout'

/**
 * Classify a transport-level LLM failure (request never answered / connection dropped).
 * null for everything else: HTTP status errors, bad output, bugs — and aborts, which are the
 * user cancelling (callers treat those as "not an error").
 */
export function llmFailureKind(err: unknown): LlmFailureKind | null {
  if (!(err instanceof Error) || err.name === 'AbortError') return null
  // OpenAI SDK APIConnectionTimeoutError / APIConnectionError: fixed messages, no HTTP status.
  if ((err as { status?: unknown }).status === undefined) {
    if (err.message === 'Request timed out.') return 'timeout'
    if (err.message === 'Connection error.') return 'network'
  }
  if (err instanceof TypeError && FETCH_FAILURE.test(err.message.trim())) return 'network'
  return null
}

/** host[:port] of the configured endpoint, for messages ("api.deepseek.com"). */
export function llmHost(baseUrl: string): string {
  try { return new URL(baseUrl).host } catch { return baseUrl }
}

/** Where users can pin the cause down — shared by every connection-failure message. */
export const LLM_PROBE_HINT = '可到「设置 → AI 模型」点「测试模型连接」自动诊断。'

export function llmFailureMessage(kind: LlmFailureKind, baseUrl: string): string {
  const host = llmHost(baseUrl)
  if (kind === 'timeout') {
    return `连接大模型接口 ${host} 超时（Request timed out）：模型服务长时间没有响应。` +
      `请稍后重试；若一直超时，请检查网络 / 代理，或换用响应更快的模型。\n${LLM_PROBE_HINT}`
  }
  return `连接大模型接口 ${host} 失败（Connection error）：请求没能到达模型服务，或中途断开。常见原因：\n` +
    `① 当前网络访问不了该地址——公司防火墙 / 代理拦截，或海外服务（如 OpenAI）在当前网络下无法直连；\n` +
    `② Base URL 填错——域名拼写或路径不对；\n` +
    `③ 该接口不允许浏览器扩展直接调用（跨域 CORS 被拒）；\n` +
    `④ 网络不稳定、连接中途断开——稍后重试即可。\n` +
    LLM_PROBE_HINT
}

/**
 * Rewrite a transport failure as an actionable Error (the original kept as `cause`); every
 * other error — including aborts — is returned untouched, so callers can simply
 * `throw explainLlmError(e, baseUrl)`.
 */
export function explainLlmError(err: unknown, baseUrl: string): unknown {
  const kind = llmFailureKind(err)
  return kind ? new Error(llmFailureMessage(kind, baseUrl), { cause: err }) : err
}
