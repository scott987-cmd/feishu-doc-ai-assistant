import type { LlmConfig } from './llmConfig'
import { assertSafeBaseUrl } from '../providers'
import { BUILD_CONFIG } from '../config'
import { llmHost } from './llmError'

export interface LlmProbeResult { ok: boolean; msg: string }

/** What an HTTP status from the chat endpoint most likely means, in user terms. */
function statusHint(status: number): string {
  if (status === 401) return 'API Key 无效或已过期'
  if (status === 402) return '账户余额不足'
  if (status === 403) return '无权访问（Key 权限不足或地区限制）'
  if (status === 404) return '地址或模型不存在（检查 Base URL 路径，如是否少了 /v1；以及模型名）'
  if (status === 400) return '请求被拒（常见原因：模型名不对）'
  if (status === 429) return '请求太频繁或额度已用完'
  if (status >= 500) return '模型服务暂时故障，请稍后再试'
  return '接口返回错误'
}

/** The provider's own error text: OpenAI-style {error:{message}}, {error:"…"}, {message}, or the raw body. */
function errorDetail(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown }
    const m = typeof j.error === 'string' ? j.error : j.error?.message ?? j.message
    if (m) return String(m).slice(0, 200)
  } catch { /* not JSON */ }
  return body.trim().slice(0, 200)
}

/** Did the server answer at all? A `no-cors` request needs no CORS approval, so success proves the
 *  host is reachable. (It can also fail for a reachable server — Chrome may block an opaque error
 *  response — so callers only trust a success.) */
async function answers(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<boolean> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    await fetchImpl(url, { mode: 'no-cors', cache: 'no-store', signal: ac.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Settings →「测试模型连接」: one tiny streamed chat request — same endpoint and same headers as
 * the real calls, so it hits the same CORS preflight — cut off as soon as the status line arrives
 * (costs next to nothing, doesn't wait for a slow model), then say precisely what went wrong.
 *
 * On a network failure the browser won't say why (DNS, firewall, TLS and a CORS refusal all look
 * alike), so we fire a `no-cors` request at the same host: if the server answers that, it is
 * reachable and the real call was refused as a cross-origin browser call.
 */
export async function probeLlm(
  cfg: LlmConfig,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<LlmProbeResult> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? 20_000
  let baseURL: string
  try {
    baseURL = assertSafeBaseUrl(cfg.baseUrl, BUILD_CONFIG.openaiAllowedHosts)
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) }
  }
  if (!cfg.apiKey.trim()) return { ok: false, msg: '请先填写 API Key。' }
  if (!cfg.model.trim()) return { ok: false, msg: '请先填写模型（Model）。' }

  const host = llmHost(baseURL)
  const ac = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; ac.abort() }, timeoutMs)
  try {
    const res = await fetchImpl(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, stream: true, messages: [{ role: 'user', content: 'ping' }] }),
      signal: ac.signal,
    })
    if (res.ok) return { ok: true, msg: `连接正常 ✓ ${host} · 模型 ${cfg.model} 已响应` }
    const detail = errorDetail(await res.text().catch(() => ''))
    return { ok: false, msg: `${statusHint(res.status)}（HTTP ${res.status}）${detail ? '：' + detail : ''}` }
  } catch {
    if (timedOut) {
      return { ok: false, msg: `连接 ${host} 超时（${Math.round(timeoutMs / 1000)} 秒无响应）：网络慢或被拦截，或模型服务繁忙，请稍后重试。` }
    }
    if (await answers(baseURL, fetchImpl, 8_000)) {
      return {
        ok: false,
        msg: `能连上 ${host}，但它拒绝了浏览器扩展的直接调用（跨域 CORS 限制）。` +
          `请换用内置厂商，或让该服务 / 网关放行浏览器跨域请求（允许 Authorization、Content-Type 请求头）。`,
      }
    }
    return {
      ok: false,
      msg: `连不上 ${host}。请检查：① Base URL 的域名是否写对；` +
        `② 当前网络能否访问它（公司防火墙 / 代理拦截；海外服务如 OpenAI 需要能直连海外的网络）；` +
        `③ 内网服务的 https 证书是否受信任；④ 该服务是否拒绝浏览器跨域调用（CORS）。`,
    }
  } finally {
    clearTimeout(timer)
    ac.abort() // success: stop the streamed generation — the status line was all we needed
  }
}
