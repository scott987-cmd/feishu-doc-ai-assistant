/**
 * 管理台服务端（运维/企业管理员用）—— 把 OAuth 代理 + 技能库 + 云备份当成【一个应用】来管。
 *
 * 单进程同源挂载：oauth-proxy-server.mjs 在 ADMIN_PASSWORD 设置时挂载本模块，提供：
 *   GET  /admin                     → 管理台单页(admin-ui.html，零依赖)
 *   POST /admin/api/login           → { password } → { token, exp }（签名会话，HMAC，无状态）
 *   GET  /admin/api/overview        → 各模块健康 + 指标 + 配置摘要 + 最近审计
 *   GET  /admin/api/skills          → 技能列表(脱敏，含分数/热度/晋级)
 *   POST /admin/api/skills/delete   → { skillId }
 *   POST /admin/api/skills/force    → { skillId, force:'promoted'|'demoted'|null }
 *   GET  /admin/api/artifacts       → 备份对象列表(tenant/openId/kind/size/mtime)
 *   POST /admin/api/artifacts/delete→ { key }
 *   GET  /admin/api/config          → 当前生效配置(密钥脱敏)
 *   GET  /admin/api/audit           → 审计环形缓冲(近 500 条)
 *
 * 鉴权：ADMIN_PASSWORD（服务端环境变量，永不下发）。登录换一枚【HMAC 签名的会话 token】(默认 8h)，
 * 之后每个 /admin/api/* 带 Authorization: Bearer。与扩展里那枚弱 proxy key 完全无关，仅运维可用。
 * 未设 ADMIN_PASSWORD → 宿主不挂载本模块（管理台彻底关闭）。
 */
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'

const env = process.env
const ADMIN_PASSWORD = env.ADMIN_PASSWORD || ''
const TTL = Number(env.ADMIN_SESSION_TTL_MIN || 480) * 60000
const LOGIN_LIMIT = Number(env.ADMIN_LOGIN_LIMIT_PER_MIN || 10)
const MAX_BODY = 16 * 1024

const HTML = (() => { try { return fs.readFileSync(new URL('./admin-ui.html', import.meta.url), 'utf8') } catch { return '<h1>admin-ui.html missing</h1>' } })()

let mods = { skills: null, artifacts: null, configSnapshot: () => ({}) }
export function setModules(m) { mods = { ...mods, ...m } }

// ── 审计环形缓冲 ──────────────────────────────────────────────────────────────
const RING = []
const RING_MAX = 500
export function recordAudit(ev) {
  RING.push({ ts: new Date().toISOString(), ...ev })
  if (RING.length > RING_MAX) RING.splice(0, RING.length - RING_MAX)
}

// ── 会话签名（无状态）──────────────────────────────────────────────────────────
const sign = (exp) => crypto.createHmac('sha256', ADMIN_PASSWORD).update(String(exp)).digest('hex')
const issueToken = () => { const exp = Date.now() + TTL; return `${exp}.${sign(exp)}` }
function verifyToken(tok) {
  const [expS, sig] = String(tok || '').split('.')
  const exp = Number(expS)
  if (!exp || exp < Date.now() || !sig) return false
  const good = sign(exp)
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))
}
const bearer = (req) => (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '')
const safeEqual = (a, b) => { const ba = Buffer.from(a || ''), bb = Buffer.from(b || ''); return ba.length === bb.length && crypto.timingSafeEqual(ba, bb) }

// 登录限流（每 IP 每分钟）
const loginBuckets = new Map()
function loginThrottled(ip) {
  const slot = Math.floor(Date.now() / 60000); const b = loginBuckets.get(ip)
  if (!b || b.slot !== slot) { loginBuckets.set(ip, { slot, n: 1 }); return false }
  b.n += 1; return b.n > LOGIN_LIMIT
}
setInterval(() => { const slot = Math.floor(Date.now() / 60000); for (const [k, v] of loginBuckets) if (v.slot < slot) loginBuckets.delete(k) }, 120000).unref()

const send = (res, status, obj, type = 'application/json') => {
  const body = type === 'application/json' ? JSON.stringify(obj) : obj
  res.writeHead(status, { 'Content-Type': type + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
  res.end(body)
}
const clientIp = (req) => (req.socket.remoteAddress || '').replace(/^::ffff:/, '')

async function readBody(req) {
  return new Promise((resolve) => {
    let size = 0; let chunks = ''
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) req.destroy(); else chunks += c })
    req.on('end', () => { try { resolve(JSON.parse(chunks || '{}')) } catch { resolve(null) } })
    req.on('error', () => resolve(null))
  })
}

// 后缀容错：oauthProxyUrl 可能带前缀。取最后一个 '/admin' 之后的子路径。
function adminSub(pathname) {
  const i = pathname.lastIndexOf('/admin')
  if (i < 0) return null
  const sub = pathname.slice(i + '/admin'.length)
  return sub === '' ? '/' : sub
}

/** 宿主对 /admin* 调它；返回 true 表示已处理。仅在 ADMIN_PASSWORD 已设时由宿主挂载。 */
export function handleAdminHttp(req, res) {
  const url = new URL(req.url, 'http://x')
  const sub = adminSub(url.pathname)
  if (sub === null) return false
  const ip = clientIp(req)

  // 单页
  if (req.method === 'GET' && (sub === '/' )) { send(res, 200, HTML, 'text/html'); return true }
  if (!sub.startsWith('/api/')) { send(res, 404, { error: 'not_found' }); return true }
  const api = sub.slice('/api'.length) // '/login' | '/overview' | ...

  if (req.method === 'POST' && api === '/login') {
    if (loginThrottled(ip)) { send(res, 429, { error: 'rate_limited' }); return true }
    readBody(req).then((b) => {
      const ok = b && typeof b.password === 'string' && safeEqual(b.password, ADMIN_PASSWORD)
      recordAudit({ module: 'admin', action: 'login', detail: { ok: !!ok }, ip })
      if (!ok) return send(res, 401, { error: 'bad_password' })
      const exp = Date.now() + TTL
      send(res, 200, { token: `${exp}.${sign(exp)}`, exp })
    })
    return true
  }

  // 之后都要鉴权
  if (!verifyToken(bearer(req))) { send(res, 401, { error: 'unauthorized' }); return true }

  if (req.method === 'GET' && api === '/overview') {
    send(res, 200, {
      time: new Date().toISOString(),
      skills: mods.skills?.skillStats?.() ?? null,
      artifacts: mods.artifacts?.artifactStats?.() ?? null,
      config: safeConfig(),
      audit: RING.slice(-20).reverse(),
    })
    return true
  }
  if (req.method === 'GET' && api === '/config') { send(res, 200, safeConfig()); return true }
  if (req.method === 'GET' && api === '/audit') { send(res, 200, { audit: [...RING].reverse() }); return true }

  if (req.method === 'GET' && api === '/skills') { send(res, 200, { skills: mods.skills?.adminListSkills?.() ?? [] }); return true }
  if (req.method === 'POST' && api === '/skills/delete') {
    readBody(req).then((b) => { const ok = !!b?.skillId && mods.skills?.adminDeleteSkill?.(b.skillId); recordAudit({ module: 'admin', action: 'skill_delete', detail: { skillId: b?.skillId, ok: !!ok }, ip }); send(res, ok ? 200 : 404, { ok: !!ok }) })
    return true
  }
  if (req.method === 'POST' && api === '/skills/force') {
    readBody(req).then((b) => { const ok = !!b?.skillId && mods.skills?.adminForceSkill?.(b.skillId, b.force ?? null); recordAudit({ module: 'admin', action: 'skill_force', detail: { skillId: b?.skillId, force: b?.force, ok: !!ok }, ip }); send(res, ok ? 200 : 404, { ok: !!ok }) })
    return true
  }

  if (req.method === 'GET' && api === '/artifacts') {
    Promise.resolve(mods.artifacts?.adminListArtifacts?.() ?? []).then((list) => send(res, 200, { artifacts: list })).catch(() => send(res, 502, { error: 'backend_error' }))
    return true
  }
  if (req.method === 'POST' && api === '/artifacts/delete') {
    readBody(req).then(async (b) => {
      try { const ok = !!b?.key && await mods.artifacts?.adminDeleteArtifact?.(b.key); recordAudit({ module: 'admin', action: 'artifact_delete', detail: { key: b?.key, ok: !!ok }, ip }); send(res, ok ? 200 : 404, { ok: !!ok }) }
      catch { send(res, 502, { error: 'backend_error' }) }
    })
    return true
  }

  send(res, 404, { error: 'not_found' })
  return true
}

function safeConfig() { try { return mods.configSnapshot?.() ?? {} } catch { return {} } }

// 独立运行（少见——一般由 oauth 代理挂载）。需要 setModules 才有数据。
const runDirect = (process.argv[1] || '').endsWith('admin-server.mjs')
if (runDirect) {
  if (!ADMIN_PASSWORD) { console.error('✗ 需要 ADMIN_PASSWORD'); process.exit(1) }
  http.createServer((req, res) => { if (!handleAdminHttp(req, res)) send(res, 404, { error: 'not_found' }) }).listen(Number(env.PORT || 8790), () => console.log(`✓ 管理台 :${env.PORT || 8790}/admin`))
}
