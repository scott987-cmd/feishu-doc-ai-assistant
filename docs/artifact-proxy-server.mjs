/**
 * 生产级「企业云备份」代理（自托管）—— 飞书文档AI助手扩展·企业版专用。
 * Production ARTIFACT-backup proxy (self-hosted) for the 飞书文档AI助手 extension (enterprise).
 *
 * 它做什么：把用户自己生成保存的产物（小程序 / AI建站 / PPT 幻灯片）镜像到【企业自有】的对象存储，
 * 一旦本地（chrome.storage.local）被清空 / 换设备 / 重装，能从云端拉回。产物是用户用本企业飞书数据
 * 生成的输出，备份进公司自己的私有存储桶。
 *
 * 安全模型（用户已选「服务端可读·企业自有存储」）：
 *   - 身份：客户端带【自己的飞书 user_access_token】，代理调飞书 user_info 校验 + FEISHU_TENANT_KEY 锁，
 *     拿到 open_id / tenant_key。**存储路径由校验出的 open_id 生成、客户端不可指定** → A 读不到 B。
 *   - 存储：blob 落在【企业自己的】私有对象存储桶（S3 兼容：AWS S3 / 阿里 OSS / 腾讯 COS / R2 / MinIO），
 *     建议桶私有 + 开启服务端加密(SSE)。可选再叠一层 ARTIFACT_ENC_KEY 的 AES-GCM 静态加密（纵深防御）。
 *   - 跨设备：不做设备绑定加密，所以换设备/重装可直接拉回（这正是备份的意义）。
 *
 * 纯 Node（node:http / node:crypto / node:fs），零依赖。Node ≥ 18（用到全局 fetch）。
 * 与 oauth-proxy-server.mjs / skill-proxy-server.mjs 同款安全中间件，可被 oauth 代理「单进程」挂载。
 *
 * ── 客户端契约（2 个端点，均 POST，token 走 body 不进 URL/日志）─────────────────
 *   POST /artifacts/put   { user_access_token, kind, items:[...] }   → { ok:true, n }
 *   POST /artifacts/pull  { user_access_token, kind }                → { items:[...] }
 *   kind ∈ { dataviz, slides }；items 为该类型本地存储的整组数组（整组镜像，覆盖写）。
 *
 * ── 运行（零配置可本地起，落地用内存；生产配 S3_* + FEISHU_TENANT_KEY）────────────
 *   FEISHU_TENANT_KEY=<你企业的 tenant_key> \
 *   S3_ENDPOINT=https://s3.ap-southeast-1.amazonaws.com S3_REGION=ap-southeast-1 \
 *   S3_BUCKET=my-feishu-artifacts S3_ACCESS_KEY=AKIA... S3_SECRET_KEY=... \
 *   PROXY_SHARED_KEY=xxx ALLOW_ORIGIN=chrome-extension://<扩展ID> \
 *   node docs/artifact-proxy-server.mjs
 *
 * ── 环境变量 ─────────────────────────────────────────────────────────────────
 *   PORT                 默认 8789
 *   ALLOW_ORIGIN         浏览器来源锁，建议 chrome-extension://<扩展ID>（默认 * 仅联调）
 *   PROXY_SHARED_KEY     共享密钥(防滥用)；设了就要求请求头 X-Proxy-Key 匹配
 *   IP_ALLOWLIST/TRUST_PROXY/RATE_LIMIT_PER_MIN   同 oauth 代理
 *   FEISHU_API_BASE      默认 https://open.feishu.cn/open-apis（私有化改对应域）
 *   FEISHU_TENANT_KEY    必填·租户锁：只放行本企业成员（不填=fail-closed 拒绝一切，防越权）
 *   MAX_ARTIFACT_BYTES   单次 put 体积上限，默认 6MB
 *   PUT_LIMIT_PER_HOUR   每用户每小时 put 次数上限，默认 240（0=不限）
 *   ── 存储后端（三选一，优先级 S3 > FS > 内存）──
 *   S3_ENDPOINT/S3_REGION/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY   S3 兼容对象存储（路径风格）
 *   S3_PREFIX            键前缀，默认 feishu-artifacts/
 *   ARTIFACTS_DIR        本地磁盘目录（未配 S3 时用；适合单机+持久卷）
 *   ARTIFACT_ENC_KEY     可选·静态再加密：32 字节密钥(hex 64 位 或 base64)，AES-256-GCM
 */
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const env = process.env
const PORT = Number(env.PORT || 8789)
const ALLOW_ORIGIN = env.ALLOW_ORIGIN || '*'
const csv = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean)
const SHARED_KEY = env.PROXY_SHARED_KEY || ''
const TENANT_KEYS = new Map(csv(env.TENANT_KEYS).map((p) => { const i = p.indexOf(':'); return [p.slice(i + 1), p.slice(0, i)] }))
const IP_ALLOWLIST = csv(env.IP_ALLOWLIST)
const TRUST_PROXY = env.TRUST_PROXY === '1'
const RATE_LIMIT = Number(env.RATE_LIMIT_PER_MIN || 120)
const API_BASE = (env.FEISHU_API_BASE || 'https://open.feishu.cn/open-apis').replace(/\/+$/, '')
const FEISHU_TENANT_KEY = env.FEISHU_TENANT_KEY || ''
const MAX_ARTIFACT_BYTES = Number(env.MAX_ARTIFACT_BYTES || 6 * 1024 * 1024)
const PUT_LIMIT_PER_HOUR = Number(env.PUT_LIMIT_PER_HOUR || 240)
const S3 = { endpoint: (env.S3_ENDPOINT || '').replace(/\/+$/, ''), region: env.S3_REGION || 'us-east-1', bucket: env.S3_BUCKET || '', ak: env.S3_ACCESS_KEY || '', sk: env.S3_SECRET_KEY || '', prefix: env.S3_PREFIX || 'feishu-artifacts/' }
const ARTIFACTS_DIR = env.ARTIFACTS_DIR || ''
const ENC_KEY = (() => {
  const raw = env.ARTIFACT_ENC_KEY || ''
  if (!raw) return null
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  return buf.length === 32 ? buf : null
})()
const KINDS = new Set(['dataviz', 'slides'])

// ── HTTP 工具（与 oauth/skill 代理同款）────────────────────────────────────────
const cors = (origin) => ({
  'Access-Control-Allow-Origin': ALLOW_ORIGIN === '*' ? '*' : (origin === ALLOW_ORIGIN ? origin : ALLOW_ORIGIN),
  'Vary': 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Key', 'Access-Control-Max-Age': '600',
})
const send = (res, status, obj, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(obj)) }
const safeEqual = (a, b) => { const ba = Buffer.from(a || ''), bb = Buffer.from(b || ''); return ba.length === bb.length && crypto.timingSafeEqual(ba, bb) }
const toU32 = (ip) => ip.split('.').reduce((n, o) => ((n << 8) | (parseInt(o, 10) & 255)) >>> 0, 0) >>> 0
const ipv4 = (ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)
function ipMatches(ip, list) { if (!ipv4(ip)) return false; const v = toU32(ip); return list.some((e) => { const [b, bits = '32'] = e.split('/'); if (!ipv4(b)) return false; const n = parseInt(bits, 10); const m = n === 0 ? 0 : (~0 << (32 - n)) >>> 0; return (v & m) === (toU32(b) & m) }) }
function clientIp(req) { if (TRUST_PROXY) { const xff = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim(); if (xff) return xff.replace(/^::ffff:/, '') } return (req.socket.remoteAddress || '').replace(/^::ffff:/, '') }
const buckets = new Map()
function rateLimited(ip) { const slot = Math.floor(Date.now() / 60000); const b = buckets.get(ip); if (!b || b.slot !== slot) { buckets.set(ip, { slot, n: 1 }); return false } b.n += 1; return b.n > RATE_LIMIT }
setInterval(() => { const slot = Math.floor(Date.now() / 60000); for (const [k, v] of buckets) if (v.slot < slot) buckets.delete(k) }, 120000).unref()
const userPut = new Map()
function userOverPutLimit(openId) { if (!PUT_LIMIT_PER_HOUR || !openId) return false; const slot = Math.floor(Date.now() / 3600000); const b = userPut.get(openId); if (!b || b.slot !== slot) { userPut.set(openId, { slot, n: 1 }); return false } b.n += 1; return b.n > PUT_LIMIT_PER_HOUR }
setInterval(() => { const slot = Math.floor(Date.now() / 3600000); for (const [k, v] of userPut) if (v.slot < slot) userPut.delete(k) }, 600000).unref()

function proxyKeyOk(req) {
  const key = req.headers['x-proxy-key']
  if (TENANT_KEYS.size) { for (const [k] of TENANT_KEYS) if (safeEqual(key, k)) return true; return false }
  if (SHARED_KEY) return safeEqual(key, SHARED_KEY)
  return true // 未配密钥：开放(仅联调)
}

// 校验 user_access_token 属于本企业，返回 { ok, openId?, tenantKey?, status?, error? }。带 5min 缓存，避免每次备份都打飞书。
const _verifyCache = new Map() // token → { openId, tenantKey, exp }
async function verifyMember(uat) {
  if (!FEISHU_TENANT_KEY) return { ok: false, status: 500, error: 'tenant_lock_required' }
  if (!uat) return { ok: false, status: 401, error: 'unauthorized' }
  const now = Date.now()
  const hit = _verifyCache.get(uat)
  if (hit && hit.exp > now) return { ok: true, openId: hit.openId, tenantKey: hit.tenantKey }
  try {
    const ui = await fetch(`${API_BASE}/authen/v1/user_info`, { headers: { Authorization: `Bearer ${uat}` } })
    const uj = await ui.json()
    if (uj.code !== 0 || !uj.data) return { ok: false, status: 401, error: 'invalid_token' }
    if (uj.data.tenant_key !== FEISHU_TENANT_KEY) return { ok: false, status: 403, error: 'not_in_tenant' }
    if (_verifyCache.size > 5000) _verifyCache.clear()
    _verifyCache.set(uat, { openId: uj.data.open_id, tenantKey: uj.data.tenant_key, exp: now + 5 * 60000 })
    return { ok: true, openId: uj.data.open_id, tenantKey: uj.data.tenant_key }
  } catch { return { ok: false, status: 502, error: 'verify_failed' } }
}

// ── 静态加密（可选）──────────────────────────────────────────────────────────
function encB(buf) { if (!ENC_KEY) return buf; const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv); const ct = Buffer.concat([c.update(buf), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]) }
function decB(buf) { if (!ENC_KEY) return buf; const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28); const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv); d.setAuthTag(tag); return Buffer.concat([d.update(ct), d.final()]) }

// ── 存储后端：put(key,buf) / get(key)->buf|null（S3 > FS > 内存）──────────────────
const sha256hex = (b) => crypto.createHash('sha256').update(b).digest('hex')
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest()
const rfc3986 = (s) => encodeURIComponent(s).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
const encPath = (p) => p.split('/').map(rfc3986).join('/')
function s3Sign(method, canonUri, body, canonQuery = '') {
  const host = new URL(S3.endpoint).host
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = sha256hex(body || Buffer.alloc(0))
  const canonHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonReq = [method, canonUri, canonQuery, canonHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${dateStamp}/${S3.region}/s3/aws4_request`
  const sts = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonReq)].join('\n')
  let k = hmac('AWS4' + S3.sk, dateStamp); k = hmac(k, S3.region); k = hmac(k, 's3'); k = hmac(k, 'aws4_request')
  const sig = crypto.createHmac('sha256', k).update(sts).digest('hex')
  return { Authorization: `AWS4-HMAC-SHA256 Credential=${S3.ak}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}`, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate }
}
async function s3Put(key, buf) {
  const canonUri = '/' + encPath(`${S3.bucket}/${key}`)
  const r = await fetch(`${S3.endpoint}${canonUri}`, { method: 'PUT', headers: { ...s3Sign('PUT', canonUri, buf), 'Content-Type': 'application/octet-stream' }, body: buf })
  if (!r.ok) throw new Error(`s3 put ${r.status} ${(await r.text()).slice(0, 200)}`)
}
async function s3Get(key) {
  const canonUri = '/' + encPath(`${S3.bucket}/${key}`)
  const r = await fetch(`${S3.endpoint}${canonUri}`, { method: 'GET', headers: s3Sign('GET', canonUri, null) })
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`s3 get ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}
async function s3Del(key) {
  const canonUri = '/' + encPath(`${S3.bucket}/${key}`)
  const r = await fetch(`${S3.endpoint}${canonUri}`, { method: 'DELETE', headers: s3Sign('DELETE', canonUri, null) })
  if (!r.ok && r.status !== 404) throw new Error(`s3 del ${r.status}`)
}
async function s3List(prefix) {
  // ListObjectsV2 — canonical query MUST be signed (sorted, percent-encoded).
  const canonUri = '/' + encPath(S3.bucket)
  const q = `list-type=2&prefix=${rfc3986(prefix)}`
  const r = await fetch(`${S3.endpoint}${canonUri}?${q}`, { method: 'GET', headers: s3Sign('GET', canonUri, null, q) })
  if (!r.ok) throw new Error(`s3 list ${r.status}`)
  const xml = await r.text()
  const out = []
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const b = m[1]
    const key = (b.match(/<Key>([^<]+)<\/Key>/) || [])[1]
    const size = Number((b.match(/<Size>(\d+)<\/Size>/) || [])[1] || 0)
    const mtime = (b.match(/<LastModified>([^<]+)<\/LastModified>/) || [])[1] || ''
    if (key) out.push({ key, size, mtime })
  }
  return out
}
const _mem = new Map()
const safeKey = (k) => k.replace(/[^A-Za-z0-9_./-]/g, '_').replace(/\.\.+/g, '_')
async function fsWalk(dir, base) {
  const out = []
  let ents = []
  try { ents = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { return out }
  for (const e of ents) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...await fsWalk(full, base))
    else { const st = await fs.promises.stat(full).catch(() => null); if (st) out.push({ key: path.relative(base, full), size: st.size, mtime: st.mtime.toISOString() }) }
  }
  return out
}
const backend = (() => {
  if (S3.endpoint && S3.bucket && S3.ak && S3.sk) return {
    kind: 'S3', put: (k, b) => s3Put(S3.prefix + k, b), get: (k) => s3Get(S3.prefix + k), del: (k) => s3Del(S3.prefix + k),
    list: async () => (await s3List(S3.prefix)).map((o) => ({ ...o, key: o.key.slice(S3.prefix.length) })),
  }
  if (ARTIFACTS_DIR) return {
    kind: 'FS',
    put: async (k, b) => { const f = path.join(ARTIFACTS_DIR, safeKey(k)); await fs.promises.mkdir(path.dirname(f), { recursive: true }); await fs.promises.writeFile(f, b) },
    get: async (k) => { try { return await fs.promises.readFile(path.join(ARTIFACTS_DIR, safeKey(k))) } catch (e) { if (e.code === 'ENOENT') return null; throw e } },
    del: async (k) => { await fs.promises.unlink(path.join(ARTIFACTS_DIR, safeKey(k))).catch(() => {}) },
    list: async () => (await fsWalk(ARTIFACTS_DIR, ARTIFACTS_DIR)).map((o) => ({ ...o, key: o.key.split(path.sep).join('/') })),
  }
  return {
    kind: 'MEM', put: async (k, b) => { _mem.set(k, b) }, get: async (k) => _mem.get(k) ?? null,
    del: async (k) => { _mem.delete(k) },
    list: async () => [..._mem.entries()].map(([key, b]) => ({ key, size: b.length, mtime: '' })),
  }
})()

const objKey = (tenantKey, openId, kind) => `${safeKey(tenantKey)}/${safeKey(openId)}/${safeKey(kind)}.json`

// ── 审计钩子 + 管理台 API ─────────────────────────────────────────────────────
let _audit = null
export function setAuditSink(fn) { _audit = fn }
const emitA = (action, detail) => { try { _audit?.({ module: 'artifacts', action, detail }) } catch { /* ignore */ } }

/** 列出所有备份对象，解析出 tenant/openId/kind。key 形如 `<tenant>/<openId>/<kind>.json`。 */
export async function adminListArtifacts() {
  const objs = await backend.list()
  return objs.filter((o) => o.key.endsWith('.json')).map((o) => {
    const parts = o.key.replace(/\.json$/, '').split('/')
    return { key: o.key, tenant: parts[0] || '', openId: parts[1] || '', kind: parts[2] || '', size: o.size, mtime: o.mtime }
  }).sort((a, b) => (b.mtime || '').localeCompare(a.mtime || ''))
}
export async function adminDeleteArtifact(key) {
  if (typeof key !== 'string' || !key.endsWith('.json')) return false
  await backend.del(safeKey(key)); emitA('artifact_delete', { key }); return true
}
export function artifactStats() { return { backend: backend.kind, enc: !!ENC_KEY, tenantLock: !!FEISHU_TENANT_KEY } }

// ── 路由分发（解耦 HTTP，便于单进程挂载 + 单测）──────────────────────────────────
export async function dispatchArtifact({ route, body }) {
  const v = await verifyMember(String(body?.user_access_token || ''))
  if (!v.ok) return { status: v.status, json: { error: v.error } }
  const kind = String(body?.kind || '')
  if (!KINDS.has(kind)) return { status: 400, json: { error: 'bad_kind' } }
  const key = objKey(v.tenantKey, v.openId, kind)

  if (route === 'put') {
    const items = Array.isArray(body?.items) ? body.items : null
    if (!items) return { status: 400, json: { error: 'bad_items' } }
    if (userOverPutLimit(v.openId)) return { status: 429, json: { error: 'quota_exceeded' } }
    const buf = encB(Buffer.from(JSON.stringify(items), 'utf8'))
    await backend.put(key, buf)
    emitA('artifact_put', { tenant: v.tenantKey, kind, n: items.length, bytes: buf.length })
    return { status: 200, json: { ok: true, n: items.length } }
  }
  if (route === 'pull') {
    const raw = await backend.get(key)
    if (!raw) return { status: 200, json: { items: [] } }
    try { return { status: 200, json: { items: JSON.parse(decB(raw).toString('utf8')) } } }
    catch { return { status: 200, json: { items: [] } } }
  }
  return { status: 404, json: { error: 'not_found' } }
}

export { encB, decB, backend, objKey, verifyMember } // 供单测/冒烟

// 后缀容错路由：oauthProxyUrl 可能带路径前缀(如 /feishu/oauth)，按结尾匹配，不依赖绝对路径。
export function routeOf(pathname) {
  if (pathname.endsWith('/healthz')) return 'health'
  if (pathname.endsWith('/artifacts/put')) return 'put'
  if (pathname.endsWith('/artifacts/pull')) return 'pull'
  return null
}

/** 宿主(oauth 代理或独立 server)对 /artifacts/* 与 /healthz 调它；返回 true 表示已处理。 */
export function handleArtifactHttp(req, res) {
  const url = new URL(req.url, 'http://x')
  const route = routeOf(url.pathname)
  if (!route) return false
  const origin = req.headers.origin || ''
  const h = cors(origin)
  if (req.method === 'OPTIONS') { res.writeHead(204, h); res.end(); return true }
  if (route === 'health') { send(res, 200, { ok: true, backend: backend.kind }, h); return true }

  if (ALLOW_ORIGIN !== '*' && origin && origin !== ALLOW_ORIGIN) { send(res, 403, { error: 'origin_forbidden' }, h); return true }
  const ip = clientIp(req)
  if (IP_ALLOWLIST.length && !ipMatches(ip, IP_ALLOWLIST)) { send(res, 403, { error: 'ip_forbidden' }, h); return true }
  if (rateLimited(ip)) { send(res, 429, { error: 'rate_limited' }, h); return true }
  if (!proxyKeyOk(req)) { send(res, 401, { error: 'unauthorized' }, h); return true }
  if (req.method !== 'POST') { send(res, 405, { error: 'method_not_allowed' }, h); return true }

  let size = 0; const parts = []
  req.on('data', (c) => { size += c.length; if (size > MAX_ARTIFACT_BYTES) req.destroy(); else parts.push(c) })
  req.on('aborted', () => { if (!res.writableEnded) send(res, 413, { error: 'too_large' }, h) })
  req.on('end', async () => {
    let body; try { body = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}') } catch { return send(res, 400, { error: 'bad_json' }, h) }
    try {
      const r = await dispatchArtifact({ route, body })
      console.log(`[artifacts] ${new Date().toISOString()} ip=${ip} ${route} kind=${body?.kind || '-'} status=${r.status}`)
      send(res, r.status, r.json, h)
    } catch (e) { console.error('[artifacts]', e?.message || e); send(res, 502, { error: 'backend_error' }, h) }
  })
  return true
}

// ── 独立运行（被 import 时不监听）────────────────────────────────────────────────
const runDirect = (process.argv[1] || '').endsWith('artifact-proxy-server.mjs')
if (runDirect) {
  http.createServer((req, res) => { if (!handleArtifactHttp(req, res)) send(res, 404, { error: 'not_found' }, cors(req.headers.origin || '')) })
    .listen(PORT, () => {
      console.log(`✓ 企业云备份代理已启动 :${PORT}`)
      console.log(`  存储后端=${backend.kind}  ALLOW_ORIGIN=${ALLOW_ORIGIN}  租户锁=${FEISHU_TENANT_KEY ? '开' : '未设(将拒绝一切)'}  静态加密=${ENC_KEY ? '开' : '关'}  单次上限=${(MAX_ARTIFACT_BYTES / 1048576).toFixed(0)}MB`)
      if (ALLOW_ORIGIN === '*') console.warn('⚠ ALLOW_ORIGIN=* —— 仅联调。生产请锁 chrome-extension://<扩展ID>。')
      if (!FEISHU_TENANT_KEY) console.warn('⚠ 未设 FEISHU_TENANT_KEY —— 备份/恢复将一律被拒(fail-closed)。请设为你企业的 tenant_key。')
      if (backend.kind === 'MEM') console.warn('⚠ 未配 S3_* / ARTIFACTS_DIR —— 用内存后端，重启即丢。生产请配对象存储或持久卷。')
    })
}
