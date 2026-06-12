/**
 * 生产级 OAuth 代理（自托管，无需 Cloudflare）—— 飞书文档AI助手扩展专用。
 * Production OAuth proxy (self-hosted, NO Cloudflare) for the 飞书文档AI助手 extension.
 *
 * 为什么要它：飞书换 token 的接口即便用 PKCE 也必须带 App Secret，纯客户端没法把 secret 留在线下。
 * 这个代理把 secret 只留在服务端；扩展只发"授权材料"（code / refresh_token），换回 token。
 * 构建扩展时设 VITE_OAUTH_PROXY_URL 指向本服务、且【不】注入 VITE_FEISHU_APP_SECRET → secret 永不进 .crx。
 *
 * 纯 Node（node:http / node:crypto），零依赖。Node ≥ 18（用到全局 fetch）。
 *
 * ── 运行 ─────────────────────────────────────────────────────────────────────
 *   FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=xxx \
 *   ALLOW_ORIGIN=chrome-extension://<你的扩展ID> \
 *   ALLOWED_REDIRECT_URIS=https://<扩展ID>.chromiumapp.org/ \
 *   node docs/oauth-proxy-server.mjs
 *
 * ── 环境变量 ─────────────────────────────────────────────────────────────────
 *   FEISHU_APP_ID            必填
 *   FEISHU_APP_SECRET        必填（只在本机环境里，绝不下发）
 *   PORT                     默认 8787
 *   FEISHU_API_BASE          默认 https://open.feishu.cn/open-apis（私有化改 https://open.<你的域>/open-apis）
 *   ALLOW_ORIGIN             允许的浏览器来源，建议锁成 chrome-extension://<扩展ID>（默认 *，仅用于联调）
 *   ALLOWED_REDIRECT_URIS    逗号分隔的 redirect_uri 白名单；只放扩展那一个，防止代理被当通用换码 oracle
 *   ALLOWED_CLIENT_IDS       逗号分隔；不填则只认 FEISHU_APP_ID
 *   PROXY_SHARED_KEY         可选·企业防滥用：设了就要求请求头 X-Proxy-Key 匹配（注意：这串会随扩展下发，
 *                            只算"防随手滥用"，不是强密钥——强控制请用下面的 IP 白名单 / 内网+SSO 网关）
 *   IP_ALLOWLIST             可选·强控制：逗号分隔的 IPv4 / CIDR（如 10.0.0.0/8,203.0.113.5）。
 *                            设了就只放行这些来源 IP —— 适合"公司固定出口 IP / 内网 / VPN"
 *   TRUST_PROXY              置 1 才信任 X-Forwarded-For（仅当本服务确实在你自己的反向代理后面时）
 *                            ⚠ 安全：置 1 时，上游反代【必须覆盖】X-Forwarded-For（如 nginx
 *                            `proxy_set_header X-Forwarded-For $remote_addr;`），绝不能【追加】，
 *                            否则客户端可伪造 XFF 绕过限流、甚至伪造命中 IP_ALLOWLIST。不在可信反代
 *                            后面就保持 0（用 socket 对端 IP）。
 *   RATE_LIMIT_PER_MIN       每 IP 每分钟上限，默认 30
 *   ── 同进程挂载的子服务（各自还有自己的 env，见对应 .mjs 文件头）──
 *   SKILLS_DISABLED=1        关闭共享技能库（/skills/*）。技能库 env 见 skill-proxy-server.mjs
 *   ARTIFACTS_DISABLED=1     关闭企业云备份（/artifacts/*）。备份 env 见 artifact-proxy-server.mjs
 *   ADMIN_PASSWORD           运维管理台密码——设了就挂载 /admin（单页 UI + /admin/api/*）。
 *                            不设=管理台彻底关闭。另见 ADMIN_SESSION_TTL_MIN（默认480=8h）/
 *                            ADMIN_LOGIN_LIMIT_PER_MIN（默认10）。详见 admin-server.mjs。
 *                            浏览器打开 https://<你的代理>/admin 登录即可统一管理技能库/备份/配置/审计。
 *
 * ── 企业级部署（无 Cloudflare）─────────────────────────────────────────────────
 *   推荐"内网 + 身份网关"，"谁能调代理 = 谁是公司员工"由企业 IdP 把关，代理只做防滥用：
 *     扩展 ──HTTPS──▶ 公司反向代理(nginx) ──▶ 本代理(127.0.0.1:8787) ──▶ 飞书
 *                         └─ 在 nginx 前置 SSO（oauth2-proxy / Authelia / 你司网关）
 *                            或：本服务只绑内网、仅 VPN 可达 + IP_ALLOWLIST
 *   - systemd:  见文件末尾示例。  - Docker:  FROM node:20-alpine + 仅暴露内网端口。
 *   - 多实例：把下面的内存限流换成 Redis（单实例够用就不用）。
 */
import http from 'node:http'
import crypto from 'node:crypto'

const env = process.env

// ── 可选·共享技能库（企业版）：单进程同源挂载 /skills/* ───────────────────────────
// 客户端把 /skills/* 打到同一个 VITE_OAUTH_PROXY_URL 上，所以这里直接挂载技能模块即可。
// 开关：SKILLS_DISABLED=1 关闭（默认开）。文件缺失/加载失败都不影响换 token 主流程。
let handleSkillHttp = null, skillMod = null
if (env.SKILLS_DISABLED !== '1') {
  try { skillMod = await import('./skill-proxy-server.mjs'); skillMod.load(); handleSkillHttp = skillMod.handleSkillHttp } catch (e) { console.warn('⚠ 技能库未挂载：', e?.message || e) }
}
// ── 可选·企业云备份（产物 → 对象存储）：同进程同源挂载 /artifacts/* ──────────────────
// 开关：ARTIFACTS_DISABLED=1 关闭（默认开）。需 FEISHU_TENANT_KEY 才会真正放行（fail-closed）。
let handleArtifactHttp = null, artifactMod = null
if (env.ARTIFACTS_DISABLED !== '1') {
  try { artifactMod = await import('./artifact-proxy-server.mjs'); handleArtifactHttp = artifactMod.handleArtifactHttp } catch (e) { console.warn('⚠ 云备份未挂载：', e?.message || e) }
}
// 管理台审计接收器 + 句柄（仅 ADMIN_PASSWORD 已设时挂载，见下方常量定义后的挂载块）。
let handleAdminHttp = null, recordAudit = () => {}
const must = (k) => { const v = env[k]; if (!v) { console.error(`✗ 缺少环境变量 ${k}`); process.exit(1) } return v }
const APP_ID = must('FEISHU_APP_ID')
const APP_SECRET = must('FEISHU_APP_SECRET')
const PORT = Number(env.PORT || 8787)
const API_BASE = (env.FEISHU_API_BASE || 'https://open.feishu.cn/open-apis').replace(/\/+$/, '')
const TOKEN_URL = `${API_BASE}/authen/v2/oauth/token`
const ALLOW_ORIGIN = env.ALLOW_ORIGIN || '*'
const csv = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean)
const ALLOWED_REDIRECT_URIS = new Set(csv(env.ALLOWED_REDIRECT_URIS))
const ALLOWED_CLIENT_IDS = new Set(csv(env.ALLOWED_CLIENT_IDS).length ? csv(env.ALLOWED_CLIENT_IDS) : [APP_ID])
const SHARED_KEY = env.PROXY_SHARED_KEY || ''
const IP_ALLOWLIST = csv(env.IP_ALLOWLIST)
const TRUST_PROXY = env.TRUST_PROXY === '1'
const RATE_LIMIT = Number(env.RATE_LIMIT_PER_MIN || 30)
// 企业版 LLM 下发（可选）：配置后，本企业飞书成员授权即可获得，无需各自填 key。
const LLM_BASE_URL = env.LLM_BASE_URL || ''
const LLM_API_KEY = env.LLM_API_KEY || ''
const LLM_MODEL = env.LLM_MODEL || ''
// 强烈建议：把 LLM 下发锁到你的企业租户（user_info.tenant_key 必须等于它），否则任何持有效飞书
// user_access_token 的人都可能取到公司 key。在飞书后台/任一 user_info 响应里可看到 tenant_key。
const FEISHU_TENANT_KEY = env.FEISHU_TENANT_KEY || ''
// 每用户(open_id) llm_config 配额（次/小时）。0=不限。配合客户端缓存，正常用绰绰有余、可挡滥用。
const LLM_LIMIT_PER_HOUR = Number(env.LLM_LIMIT_PER_HOUR || 0)
// 企业统一策略（可选）：客户端拉取后强制并锁定对应开关。空=不下发该项。
const POLICY = {
  // Only fields the client actually enforces (settings-level toggles). Clip is a build-time flag
  // (VITE_CLIP_ENABLED), not runtime-lockable, so it's intentionally NOT a policy field.
  auto_confirm: env.POLICY_AUTO_CONFIRM === undefined ? null : env.POLICY_AUTO_CONFIRM === '1',
  learn_from_history: env.POLICY_LEARN === undefined ? null : env.POLICY_LEARN === '1',
  notice: env.POLICY_NOTICE || '',
}
const GRANTS = new Set(['authorization_code', 'refresh_token'])
const MAX_BODY = 8 * 1024 // 授权材料很小，超过即拒（防滥用 / 内存）

// ── 工具 ─────────────────────────────────────────────────────────────────────
const cors = (origin) => ({
  'Access-Control-Allow-Origin': ALLOW_ORIGIN === '*' ? '*' : (origin === ALLOW_ORIGIN ? origin : ALLOW_ORIGIN),
  'Vary': 'Origin',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Key',
  'Access-Control-Max-Age': '600',
})
const send = (res, status, obj, headers = {}) => {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...headers })
  res.end(body)
}
// 不区分时序地比较共享密钥
const safeEqual = (a, b) => {
  const ba = Buffer.from(a || ''), bb = Buffer.from(b || '')
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb)
}
// IPv4 CIDR 命中（支持单 IP 与 a.b.c.d/n）
const toU32 = (ip) => ip.split('.').reduce((n, o) => ((n << 8) | (parseInt(o, 10) & 255)) >>> 0, 0) >>> 0
const ipv4 = (ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)
function ipMatches(ip, list) {
  if (!ipv4(ip)) return false
  const v = toU32(ip)
  return list.some((entry) => {
    const [base, bits = '32'] = entry.split('/')
    if (!ipv4(base)) return false
    const n = parseInt(bits, 10)
    const mask = n === 0 ? 0 : (~0 << (32 - n)) >>> 0
    return (v & mask) === (toU32(base) & mask)
  })
}
function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim()
    if (xff) return xff.replace(/^::ffff:/, '')
  }
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '')
}
// 每 IP 固定窗口限流（单实例内存版）
const buckets = new Map()
function rateLimited(ip) {
  const now = Date.now(), slot = Math.floor(now / 60000)
  const b = buckets.get(ip)
  if (!b || b.slot !== slot) { buckets.set(ip, { slot, n: 1 }); return false }
  b.n += 1
  return b.n > RATE_LIMIT
}
setInterval(() => { const slot = Math.floor(Date.now() / 60000); for (const [k, v] of buckets) if (v.slot < slot) buckets.delete(k) }, 120000).unref()

// 每用户(open_id) 每小时配额（llm_config）。0=不限。
const userBuckets = new Map()
function userOverLimit(openId) {
  if (!LLM_LIMIT_PER_HOUR || !openId) return false
  const slot = Math.floor(Date.now() / 3600000)
  const b = userBuckets.get(openId)
  if (!b || b.slot !== slot) { userBuckets.set(openId, { slot, n: 1 }); return false }
  b.n += 1
  return b.n > LLM_LIMIT_PER_HOUR
}
setInterval(() => { const slot = Math.floor(Date.now() / 3600000); for (const [k, v] of userBuckets) if (v.slot < slot) userBuckets.delete(k) }, 600000).unref()

// 校验 user_access_token 属于本企业（飞书 user_info + tenant_key 锁）。返回 {ok, data?}.
async function verifyTenantMember(uat) {
  // Fail-CLOSED: refuse to hand out company config unless the deploy is locked to a tenant —
  // otherwise ANY valid Feishu token (any tenant) would pass. FEISHU_TENANT_KEY is mandatory.
  if (!FEISHU_TENANT_KEY) return { ok: false, status: 500, error: 'tenant_lock_required' }
  if (!uat) return { ok: false, status: 401, error: 'unauthorized' }
  try {
    const ui = await fetch(`${API_BASE}/authen/v1/user_info`, { headers: { Authorization: `Bearer ${uat}` } })
    const uj = await ui.json()
    if (uj.code !== 0 || !uj.data) return { ok: false, status: 401, error: 'invalid_token' }
    if (FEISHU_TENANT_KEY && uj.data.tenant_key !== FEISHU_TENANT_KEY) return { ok: false, status: 403, error: 'not_in_tenant' }
    return { ok: true, data: uj.data }
  } catch { return { ok: false, status: 502, error: 'verify_failed' } }
}
// 结构化审计（不含任何 token/code/secret/敏感内容）。也送进管理台审计环（若已挂载）。
function audit(ip, action, openId, status) {
  console.log(`[audit] ${new Date().toISOString()} ip=${ip} action=${action} user=${openId || '-'} status=${status}`)
  try { recordAudit({ module: 'oauth', action, detail: { user: openId || '-', status }, ip }) } catch { /* ignore */ }
}

// ── 可选·管理台（运维 UI）：ADMIN_PASSWORD 已设才挂载 /admin + /admin/api/* ──────────
// 当前生效配置快照（密钥脱敏），供管理台「配置巡检」。App ID 是公开值可显示；secret/key 一律打码。
const _mask = (s) => (s ? '****' + String(s).slice(-4) : '')
function configSnapshot() {
  return {
    oauth: { app_id: APP_ID, app_secret: _mask(APP_SECRET), api_base: API_BASE, allow_origin: ALLOW_ORIGIN, tenant_lock: !!FEISHU_TENANT_KEY, shared_key: !!SHARED_KEY, redirect_allowlist: ALLOWED_REDIRECT_URIS.size, ip_allowlist: IP_ALLOWLIST.length, rate_limit_per_min: RATE_LIMIT },
    managed_llm: { enabled: !!(LLM_API_KEY && LLM_BASE_URL && LLM_MODEL), base_url: LLM_BASE_URL, model: LLM_MODEL, api_key: _mask(LLM_API_KEY), tenant_lock: !!FEISHU_TENANT_KEY, per_user_per_hour: LLM_LIMIT_PER_HOUR },
    policy: POLICY,
    features: { skills: !!skillMod, artifacts: !!artifactMod, managed_app_id: 'app_config 端点已内置' },
  }
}
if (env.ADMIN_PASSWORD) {
  try {
    const adminMod = await import('./admin-server.mjs')
    recordAudit = adminMod.recordAudit
    adminMod.setModules({ skills: skillMod, artifacts: artifactMod, configSnapshot })
    skillMod?.setAuditSink?.(recordAudit)
    artifactMod?.setAuditSink?.(recordAudit)
    handleAdminHttp = adminMod.handleAdminHttp
    console.log('✓ 管理台已挂载 → /admin')
  } catch (e) { console.warn('⚠ 管理台未挂载：', e?.message || e) }
}

// ── 服务 ─────────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const origin = req.headers.origin || ''
  const h = cors(origin)

  // 健康检查：本进程自己先答（否则会被技能模块的 endsWith('/healthz') 抢走）。仅 liveness——只回 {ok:true}，
  // 不泄露技能数/后端类型等运营信息（这些在【鉴权】的管理台总览里看）；健康探针常来自不在 IP 白名单里的 LB。
  if (req.method === 'GET' && req.url === '/healthz') return send(res, 200, { ok: true }, h)

  // IP 白名单：必须在【所有】子服务（含管理台）分发之前统一把关——否则 /admin* 会先被 handleAdminHttp
  // 处理掉，绕过运维以为已生效的网络层白名单（管理台能删备份/改技能，绝不能让它脱离 IP 白名单暴露在公网）。
  const ip = clientIp(req)
  if (IP_ALLOWLIST.length && !ipMatches(ip, IP_ALLOWLIST)) return send(res, 403, { error: 'ip_forbidden' }, h)

  // 管理台（若启用）：/admin* 必须最先匹配，否则 /admin/api/skills/* 会被技能模块的 '/skills/' 抢走。
  if (handleAdminHttp) { try { if (handleAdminHttp(req, res)) return } catch (e) { console.error('[admin] http error:', e?.message || e) } }
  // 共享技能库（若启用）：/skills/* 由技能模块自带 CORS/鉴权/限流处理，处理了就直接返回。
  if (handleSkillHttp) { try { if (handleSkillHttp(req, res)) return } catch (e) { console.error('[skills] http error:', e?.message || e) } }
  // 企业云备份（若启用）：/artifacts/* 由云备份模块自带 CORS/鉴权/租户校验处理。
  if (handleArtifactHttp) { try { if (handleArtifactHttp(req, res)) return } catch (e) { console.error('[artifacts] http error:', e?.message || e) } }

  if (req.method === 'OPTIONS') { res.writeHead(204, h); return res.end() }
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' }, h)

  // 来源锁定：浏览器会带 Origin；锁了 ALLOW_ORIGIN 就拒绝其它来源（注意 CORS 只挡浏览器，非强鉴权）
  if (ALLOW_ORIGIN !== '*' && origin && origin !== ALLOW_ORIGIN) return send(res, 403, { error: 'origin_forbidden' }, h)

  if (rateLimited(ip)) return send(res, 429, { error: 'rate_limited' }, h)
  if (SHARED_KEY && !safeEqual(req.headers['x-proxy-key'], SHARED_KEY)) return send(res, 401, { error: 'unauthorized' }, h)

  let size = 0, chunks = ''
  req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { req.destroy(); } else chunks += c })
  req.on('aborted', () => { if (!res.writableEnded) send(res, 413, { error: 'too_large' }, h) }) // 超限 → 干净的 413
  req.on('end', async () => {
    let body
    try { body = JSON.parse(chunks || '{}') } catch { return send(res, 400, { error: 'bad_json' }, h) }

    const grant_type = String(body.grant_type || '')

    // ── 企业版：下发大模型(LLM)配置，仅限本企业飞书成员 ──────────────────────────
    // 客户端用【自己的 user_access_token】证明身份；代理向飞书 user_info 校验 + tenant_key 锁，
    // 再按 open_id 配额限流，才返回 LLM_* 配置。公司密钥永不进 .crx。
    if (grant_type === 'llm_config') {
      if (!LLM_API_KEY || !LLM_BASE_URL || !LLM_MODEL) return send(res, 404, { error: 'llm_not_configured' }, h)
      const v = await verifyTenantMember(String(body.user_access_token || ''))
      if (!v.ok) { audit(ip, 'llm_config', '', v.status); return send(res, v.status, { error: v.error }, h) }
      if (userOverLimit(v.data.open_id)) { audit(ip, 'llm_config', v.data.open_id, 429); return send(res, 429, { error: 'quota_exceeded' }, h) }
      audit(ip, 'llm_config', v.data.open_id, 200)
      return send(res, 200, { base_url: LLM_BASE_URL, api_key: LLM_API_KEY, model: LLM_MODEL }, h)
    }

    // ── 企业版：下发 App ID（公开值，OAuth URL 里本就可见）——无需 token，仅过共享密钥/来源/IP/限流。
    // 让企业构建不必打包 App ID：单一构建只内置代理地址即可服务任意租户，App ID 可服务端轮换。
    if (grant_type === 'app_config') {
      console.log(`[proxy] ${new Date().toISOString()} ip=${ip} grant=app_config status=200`)
      recordAudit({ module: 'oauth', action: 'app_config', detail: { status: 200 }, ip })
      return send(res, 200, { app_id: APP_ID }, h)
    }

    // ── 企业版：下发统一策略（强制并锁定客户端开关），同样仅限本企业成员 ──────────────
    if (grant_type === 'policy') {
      const v = await verifyTenantMember(String(body.user_access_token || ''))
      if (!v.ok) { audit(ip, 'policy', '', v.status); return send(res, v.status, { error: v.error }, h) }
      audit(ip, 'policy', v.data.open_id, 200)
      return send(res, 200, { policy: POLICY }, h)
    }

    if (!GRANTS.has(grant_type)) return send(res, 400, { error: 'unsupported_grant_type' }, h)
    if (!ALLOWED_CLIENT_IDS.has(String(body.client_id || ''))) return send(res, 403, { error: 'client_id_forbidden' }, h)

    // 代理注入 secret；客户端从不发送 secret。
    const payload = { grant_type, client_id: APP_ID, client_secret: APP_SECRET }
    if (grant_type === 'authorization_code') {
      const redirect_uri = String(body.redirect_uri || '')
      // Fail-CLOSED: refuse to exchange a code unless a redirect_uri allowlist is configured AND
      // matches — otherwise the proxy is a generic code→token oracle (stolen/phished codes laundered
      // into tokens for arbitrary redirects). Always set ALLOWED_REDIRECT_URIS.
      if (!ALLOWED_REDIRECT_URIS.size || !ALLOWED_REDIRECT_URIS.has(redirect_uri)) return send(res, 400, { error: 'redirect_uri_forbidden' }, h)
      payload.code = String(body.code || '')
      payload.redirect_uri = redirect_uri
    } else {
      payload.refresh_token = String(body.refresh_token || '')
    }

    try {
      const upstream = await fetch(TOKEN_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const text = await upstream.text() // 原样透传飞书的 token JSON（不解析、不落盘、不打印）
      res.writeHead(upstream.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...h })
      res.end(text)
      // 仅记录"发生了一次换 token"，不含任何 token / code / secret
      console.log(`[proxy] ${new Date().toISOString()} ip=${ip} grant=${grant_type} status=${upstream.status}`)
      recordAudit({ module: 'oauth', action: `token:${grant_type}`, detail: { status: upstream.status }, ip })
    } catch (e) {
      send(res, 502, { error: 'upstream_unreachable' }, h)
      console.error(`[proxy] upstream error: ${e instanceof Error ? e.message : e}`)
    }
  })
})

server.listen(PORT, () => {
  console.log(`✓ OAuth 代理已启动 :${PORT}  → 上游 ${TOKEN_URL}`)
  console.log(`  ALLOW_ORIGIN=${ALLOW_ORIGIN}  redirect白名单=${ALLOWED_REDIRECT_URIS.size || '(未设)'}  IP白名单=${IP_ALLOWLIST.length || '(未设)'}  共享密钥=${SHARED_KEY ? '开' : '关'}  限流=${RATE_LIMIT}/min`)
  if (ALLOW_ORIGIN === '*') console.warn('⚠ ALLOW_ORIGIN=* —— 仅用于本地联调。生产务必锁成 chrome-extension://<扩展ID>，否则任意网页可跨域读取返回的 token。')
  if (!ALLOWED_REDIRECT_URIS.size) console.warn('⚠ 未设 ALLOWED_REDIRECT_URIS —— code 换 token 将一律被拒（fail-closed）。请设为扩展回调地址。')
})

// 优雅退出：本进程挂载了技能库时，其落盘是 5s 脏写定时器，重启会丢最近的上报——这里在退出前 flush。
// （技能模块只有 standalone 运行才装自己的信号处理；mounted 模式由本宿主负责。）
const shutdown = () => { try { skillMod?.persist?.() } catch { /* best-effort */ } process.exit(0) }
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

/* ── systemd 示例（/etc/systemd/system/feishu-oauth-proxy.service）─────────────
[Unit]
Description=Feishu OAuth Proxy
After=network.target
[Service]
Environment=FEISHU_APP_ID=cli_xxx
Environment=FEISHU_APP_SECRET=xxx
Environment=ALLOW_ORIGIN=chrome-extension://<扩展ID>
Environment=ALLOWED_REDIRECT_URIS=https://<扩展ID>.chromiumapp.org/
Environment=IP_ALLOWLIST=10.0.0.0/8
ExecStart=/usr/bin/node /opt/feishu-oauth-proxy/oauth-proxy-server.mjs
User=feishuproxy
Restart=on-failure
[Install]
WantedBy=multi-user.target
──────────────────────────────────────────────────────────────────────────── */
