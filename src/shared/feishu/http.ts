/** Shared Feishu Open API request helper (used by sheets.ts / docx.ts / api.ts). */
import { FEISHU_API_BASE, IS_PRIVATE_DEPLOY, isFeishuOutboundAllowed } from '../config'
import { versionCandidates, rememberVersion } from './version'
const BASE = FEISHU_API_BASE
const TIMEOUT_MS = 30_000

/**
 * fetch with a timeout, and bounded retries for IDEMPOTENT methods only. Writes
 * (POST/PUT/PATCH/DELETE) are NEVER auto-retried — a timed-out create may have
 * actually succeeded, so retrying would duplicate it (e.g. two tables). Reads are
 * safe to retry on transient network failures.
 */
export async function robustFetch(url: string, init: RequestInit, method: string): Promise<Response> {
  const maxAttempts = method.toUpperCase() === 'GET' ? 3 : 1
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      return await fetch(url, { ...init, signal: ctrl.signal })
    } catch (err) {
      lastErr = err
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 400 * attempt))
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`网络请求失败（已重试 ${maxAttempts} 次）：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`)
}

/**
 * Make a Feishu request, returning the raw Response. On a PRIVATE deploy, if the path's
 * `/<svc>/vN/` endpoint 404s (version not present on the lagging instance) it transparently
 * retries v(N-1)…v1 and remembers the version that exists. 404 = request never executed, so
 * this is safe for writes too. SaaS = single shot (no extra cost). Shared by feishuReq + api.ts.
 */
export async function feishuFetch(
  method: string,
  path: string,
  token: string,
  body?: unknown,
  params?: Record<string, string>
): Promise<Response> {
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }
  const candidates = IS_PRIVATE_DEPLOY ? versionCandidates(path) : [{ path, ver: 0 }]
  let last: Response | null = null
  for (const cand of candidates) {
    const url = new URL(`${BASE}${cand.path}`)
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
    // Code-layer allowlist: a Feishu call must target a configured Feishu host.
    if (!isFeishuOutboundAllowed(url.toString())) {
      throw new Error(`出站被拦截：${url.hostname} 不在允许的飞书主机列表内`)
    }
    const res = await robustFetch(url.toString(), init, method)
    // Only downgrade on a *gateway* 404 (the API path/version is truly absent). A Feishu RESOURCE
    // error (deleted record, bad token, no permission) comes back as a structured {code,msg}
    // envelope — sometimes with HTTP 404 — and MUST NOT trigger a downgrade: doing so would hit a
    // different-contract older endpoint and (via rememberVersion) poison the cache for the whole
    // service. So on a 404 we peek the body: a Feishu envelope ⇒ the version exists, return it.
    if (res.status === 404 && cand.ver > 1) {
      const text = await res.text()
      let isFeishuEnvelope = false
      try { const j = JSON.parse(text); isFeishuEnvelope = !!j && typeof j.code === 'number' } catch { /* non-JSON gateway 404 */ }
      const rewrapped = new Response(text, { status: 404, statusText: res.statusText, headers: res.headers })
      if (!isFeishuEnvelope) { last = rewrapped; continue }  // path/version absent → try older version
      rememberVersion(path, cand.ver)                        // resource/business error on a version that EXISTS
      return rewrapped
    }
    if (res.status !== 404) rememberVersion(path, cand.ver)  // this version exists → cache it
    return res
  }
  return last as Response
}

export async function feishuReq<T = unknown>(
  method: string,
  path: string,
  token: string,
  body?: unknown,
  params?: Record<string, string>
): Promise<T> {
  const res = await feishuFetch(method, path, token, body, params)

  const json = (await res.json()) as { code: number; msg: string; data: T }
  if (!res.ok || json.code !== 0) {
    const isForbidden = /unauthorized|forbidden|permission|denied|1310213|1770032|91403/i.test(json.msg) || res.status === 403
    const hint = isForbidden
      ? '（应用对该资源无编辑权限。这是你本人创建的文档/表格？应用与你是两个不同身份——请在「设置」填入有编辑权限的 user_access_token 以你的身份操作，或在该文档右上「分享」把应用加为可编辑协作者）'
      : ''
    throw new Error(`Feishu API error (code=${json.code}): ${json.msg}${hint}`)
  }
  return json.data
}
