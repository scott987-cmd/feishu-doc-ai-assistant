/**
 * 生产级「共享技能库」代理（自托管）—— 飞书文档AI助手扩展·企业版专用。
 * Production SKILL-library proxy (self-hosted) for the 飞书文档AI助手 extension (enterprise).
 *
 * 它做什么：把每个用户「成功做法」的**脱敏经验**汇聚到一处，服务端做去重 / 语义聚合 / 打分 / 晋级，
 * 客户端再把社区高分技能当作提示注入、或在失败时回查。用的人越多，越快越聪明。
 *
 * 隐私边界（与客户端 src/shared/ai/skills.ts 对齐）：客户端【只】上报脱敏数据——
 *   - intent：LLM 蒸馏后的「无数据」一句话经验（再经 redactSensitive 脱敏）
 *   - toolSequence：工具**名**序列（无参数、无值）
 *   - outcome：success / undone
 *   - src：匿名安装 id（随机、与身份无关，仅用于「去重热度」计数）
 * 服务端从不接触原始任务文本 / 表名字段名 / 单元格值。Embedding 在服务端算。
 *
 * 纯 Node（node:http / node:crypto），零依赖。Node ≥ 18（用到全局 fetch）。
 * 与 oauth-proxy-server.mjs 同款安全中间件（CORS / X-Proxy-Key / IP 白名单 / 限流）。
 *
 * ── 客户端契约（必须实现的 3 个端点）─────────────────────────────────────────────
 *   POST /skills/report  { resourceKind, intent, toolSequence[], outcome, src }      → { ok:true }
 *   POST /skills/match   { resourceKind, intent, k }                                  → { skills:[Skill] }
 *   GET  /skills/preload?kind=base|sheet|doc|general                                  → { skills:[Skill] }
 *   Skill = { skillId, level:'recipe'|'playbook', resourceKind, intent, toolSequence[], lesson, score }
 *
 * ── 运行（零配置即可本地起，落地用内存假 embedding；生产请配 EMBED_URL）─────────────
 *   PROXY_SHARED_KEY=xxx ALLOW_ORIGIN=chrome-extension://<扩展ID> \
 *   EMBED_URL=https://api.openai.com/v1/embeddings EMBED_KEY=sk-xxx EMBED_MODEL=text-embedding-3-small \
 *   SKILLS_FILE=/var/lib/feishu-skills/store.json \
 *   node docs/skill-proxy-server.mjs
 *
 * ── 环境变量 ─────────────────────────────────────────────────────────────────
 *   PORT                 默认 8788（与 oauth 代理 8787 区分；两者可同机不同端口）
 *   ALLOW_ORIGIN         浏览器来源锁，建议 chrome-extension://<扩展ID>（默认 * 仅联调）
 *   PROXY_SHARED_KEY     单租户共享密钥；设了就要求请求头 X-Proxy-Key 匹配
 *   TENANT_KEYS          多租户：逗号分隔的 "租户ID:密钥" 对（如 acme:k1,globex:k2）。
 *                        设了就按命中的密钥归属租户；脱敏池全局共享、但按租户计热度/审计。
 *   IP_ALLOWLIST         逗号分隔 IPv4 / CIDR，强控制来源
 *   TRUST_PROXY          置 1 才信任 X-Forwarded-For
 *   RATE_LIMIT_PER_MIN   每 IP 每分钟上限，默认 120
 *   SKILLS_FILE          可选·JSON 落盘路径（不设=纯内存，重启即丢）。多实例请换 Redis/PG。
 *   EMBED_URL/KEY/MODEL  可选·OpenAI 兼容 embedding 接口。不设=用内存版确定性假向量（可跑、可测，
 *                        但语义聚类弱）。生产强烈建议配真 embedding。
 *   SIM_MERGE            去重合并的余弦阈值，默认 0.86
 *   TOOL_MERGE           去重合并的工具序列 Jaccard 阈值，默认 0.4
 *   MIN_SOURCES          晋级所需「不同贡献者」数，默认 2（跨人验证；单测可设 1）
 *   MIN_SUCCESS_RATE     晋级所需成功率，默认 0.6
 *   W_USERS/W_SUCCESS/W_RECENCY/W_UNDONE  打分权重，默认 1 / 1 / 0.5 / 1.5
 *   PLAYBOOK_MIN         合成「套路」所需的同类高分 recipe 数，默认 3
 */
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'

const env = process.env
const PORT = Number(env.PORT || 8788)
const ALLOW_ORIGIN = env.ALLOW_ORIGIN || '*'
const csv = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean)
const SHARED_KEY = env.PROXY_SHARED_KEY || ''
const TENANT_KEYS = new Map(csv(env.TENANT_KEYS).map((p) => { const i = p.indexOf(':'); return [p.slice(i + 1), p.slice(0, i)] })) // key → tenantId
const IP_ALLOWLIST = csv(env.IP_ALLOWLIST)
const TRUST_PROXY = env.TRUST_PROXY === '1'
const RATE_LIMIT = Number(env.RATE_LIMIT_PER_MIN || 120)
const SKILLS_FILE = env.SKILLS_FILE || ''
const EMBED_URL = env.EMBED_URL || ''
const EMBED_KEY = env.EMBED_KEY || ''
const EMBED_MODEL = env.EMBED_MODEL || 'text-embedding-3-small'
const SIM_MERGE = Number(env.SIM_MERGE || 0.86)
const TOOL_MERGE = Number(env.TOOL_MERGE || 0.4)
const MIN_SOURCES = Number(env.MIN_SOURCES || 2)
const MIN_SUCCESS_RATE = Number(env.MIN_SUCCESS_RATE || 0.6)
const W = { users: Number(env.W_USERS ?? 1), success: Number(env.W_SUCCESS ?? 1), recency: Number(env.W_RECENCY ?? 0.5), undone: Number(env.W_UNDONE ?? 1.5) }
const PLAYBOOK_MIN = Number(env.PLAYBOOK_MIN || 3)
const SKILLS_MAX = Number(env.SKILLS_MAX || 20000) // 技能条数上限：防持(弱)代理密钥者用随机上报撑爆内存/磁盘
const MAX_BODY = 16 * 1024
const KINDS = new Set(['base', 'sheet', 'doc', 'wiki', 'general'])

// ── HTTP 工具（与 oauth 代理同款）─────────────────────────────────────────────
const cors = (origin) => ({
  'Access-Control-Allow-Origin': ALLOW_ORIGIN === '*' ? '*' : (origin === ALLOW_ORIGIN ? origin : ALLOW_ORIGIN),
  'Vary': 'Origin',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Key',
  'Access-Control-Max-Age': '600',
})
const send = (res, status, obj, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...headers })
  res.end(JSON.stringify(obj))
}
const safeEqual = (a, b) => { const ba = Buffer.from(a || ''), bb = Buffer.from(b || ''); return ba.length === bb.length && crypto.timingSafeEqual(ba, bb) }
const toU32 = (ip) => ip.split('.').reduce((n, o) => ((n << 8) | (parseInt(o, 10) & 255)) >>> 0, 0) >>> 0
const ipv4 = (ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)
function ipMatches(ip, list) {
  if (!ipv4(ip)) return false
  const v = toU32(ip)
  return list.some((entry) => { const [b, bits = '32'] = entry.split('/'); if (!ipv4(b)) return false; const n = parseInt(bits, 10); const m = n === 0 ? 0 : (~0 << (32 - n)) >>> 0; return (v & m) === (toU32(b) & m) })
}
function clientIp(req) {
  if (TRUST_PROXY) { const xff = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim(); if (xff) return xff.replace(/^::ffff:/, '') }
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '')
}
const buckets = new Map()
function rateLimited(ip) {
  const slot = Math.floor(Date.now() / 60000); const b = buckets.get(ip)
  if (!b || b.slot !== slot) { buckets.set(ip, { slot, n: 1 }); return false }
  b.n += 1; return b.n > RATE_LIMIT
}
setInterval(() => { const slot = Math.floor(Date.now() / 60000); for (const [k, v] of buckets) if (v.slot < slot) buckets.delete(k) }, 120000).unref()

/** 认证 + 归属租户。返回 { ok, tenant?, status?, error? }。 */
function authTenant(req) {
  const key = req.headers['x-proxy-key']
  if (TENANT_KEYS.size) { // 多租户：密钥决定租户
    for (const [k, tid] of TENANT_KEYS) if (safeEqual(key, k)) return { ok: true, tenant: tid }
    return { ok: false, status: 401, error: 'unauthorized' }
  }
  if (SHARED_KEY) { return safeEqual(key, SHARED_KEY) ? { ok: true, tenant: 'default' } : { ok: false, status: 401, error: 'unauthorized' } }
  return { ok: true, tenant: 'default' } // 未配密钥：开放（仅联调/单测）
}

// ── 向量 / 相似度 ─────────────────────────────────────────────────────────────
const DIM = 256
function localEmbed(text) { // 确定性「假」向量：字符 bigram 哈希袋，L2 归一。无外部依赖，可跑可测。
  const v = new Float64Array(DIM)
  const t = (text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2)
    let hsh = 2166136261; for (let j = 0; j < g.length; j++) { hsh ^= g.charCodeAt(j); hsh = Math.imul(hsh, 16777619) }
    v[(hsh >>> 0) % DIM] += 1
  }
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1
  return Array.from(v, (x) => x / n)
}
const _embedCache = new Map() // text → vec（避免重复算 embedding）
async function embed(text) {
  const key = crypto.createHash('sha1').update(text || '').digest('hex')
  const hit = _embedCache.get(key); if (hit) return hit
  let vec
  if (EMBED_URL && EMBED_KEY) {
    try {
      const r = await fetch(EMBED_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${EMBED_KEY}` }, body: JSON.stringify({ model: EMBED_MODEL, input: [text || ''] }) })
      const j = await r.json(); const e = j?.data?.[0]?.embedding
      if (Array.isArray(e) && e.length) { let n = 0; for (const x of e) n += x * x; n = Math.sqrt(n) || 1; vec = e.map((x) => x / n) }
    } catch { /* 失败回退本地假向量，服务不中断 */ }
  }
  if (!vec) vec = localEmbed(text)
  if (_embedCache.size > 5000) _embedCache.clear()
  _embedCache.set(key, vec)
  return vec
}
const cosine = (a, b) => { if (!a || !b || a.length !== b.length) return 0; let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d } // 均已归一 → 点积即余弦
function toolJaccard(a, b) { const A = new Set(a), B = new Set(b); if (!A.size || !B.size) return 0; let inter = 0; for (const x of A) if (B.has(x)) inter++; return inter / (A.size + B.size - inter) }

// ── 技能存储（内存 + 可选落盘）────────────────────────────────────────────────
/** skill = { skillId, resourceKind, lesson, intent, toolSequence, vec,
 *            toolCounts:{[serializedSeq]:count}, successes, undones,
 *            sources:Set, tenants:Set, firstTs, lastTs } */
const skills = []
function persist() {
  if (!SKILLS_FILE) return
  try {
    const dump = skills.map((s) => ({ ...s, sources: [...s.sources], tenants: [...s.tenants] }))
    fs.writeFileSync(SKILLS_FILE, JSON.stringify(dump), 'utf8')
  } catch (e) { console.error('[skills] persist failed:', e?.message || e) }
}
function load() {
  if (!SKILLS_FILE || !fs.existsSync(SKILLS_FILE)) return
  try {
    const arr = JSON.parse(fs.readFileSync(SKILLS_FILE, 'utf8'))
    for (const s of arr) skills.push({ ...s, sources: new Set(s.sources || []), tenants: new Set(s.tenants || []), toolCounts: s.toolCounts || {} })
    console.log(`[skills] loaded ${skills.length} skills from ${SKILLS_FILE}`)
  } catch (e) { console.error('[skills] load failed:', e?.message || e) }
}
let _dirty = false
const markDirty = () => { _dirty = true }
setInterval(() => { if (_dirty) { _dirty = false; persist() } }, 5000).unref()

const shortIntent = (lesson) => (lesson || '').split(/[。．.：:，,；;\n]/)[0].trim().slice(0, 40) || (lesson || '').slice(0, 40)
const total = (s) => s.successes + s.undones
const successRate = (s) => (total(s) ? s.successes / total(s) : 0)
const undoneRate = (s) => (total(s) ? s.undones / total(s) : 0)
function score(s, now) {
  const ageDays = (now - s.lastTs) / 86400000
  const recency = Math.exp(-ageDays / 30) // 30 天半衰量级
  return W.users * Math.log1p(s.sources.size) + W.success * successRate(s) + W.recency * recency - W.undone * undoneRate(s)
}
//  晋级判定：管理员强制(forced)优先，否则按阈值。
const isPromoted = (s) => s.forced === 'promoted' ? true : s.forced === 'demoted' ? false
  : (s.sources.size >= MIN_SOURCES && successRate(s) >= MIN_SUCCESS_RATE)

// ── 审计钩子（由宿主注入，best-effort，不注入也能跑）──────────────────────────────
let _audit = null
export function setAuditSink(fn) { _audit = fn }
const emit = (action, detail) => { try { _audit?.({ module: 'skills', action, detail }) } catch { /* ignore */ } }

// ── 管理台 API（运维用，读写）──────────────────────────────────────────────────
export function adminListSkills(now = Date.now()) {
  return skills.map((s) => ({
    skillId: s.skillId, resourceKind: s.resourceKind, intent: s.intent, lesson: s.lesson,
    toolSequence: s.toolSequence, successes: s.successes, undones: s.undones,
    sources: s.sources.size, tenants: s.tenants.size, lastTs: s.lastTs,
    score: Math.round(score(s, now) * 100) / 100, promoted: isPromoted(s), forced: s.forced ?? null,
  })).sort((a, b) => b.score - a.score)
}
export function adminDeleteSkill(id) {
  const i = skills.findIndex((s) => s.skillId === id)
  if (i < 0) return false
  skills.splice(i, 1); markDirty(); emit('skill_delete', { skillId: id }); return true
}
/** force ∈ 'promoted' | 'demoted' | null(恢复按阈值自动判定)。 */
export function adminForceSkill(id, force) {
  const s = skills.find((x) => x.skillId === id)
  if (!s) return false
  s.forced = (force === 'promoted' || force === 'demoted') ? force : null
  markDirty(); emit('skill_force', { skillId: id, forced: s.forced }); return true
}
export function skillStats(now = Date.now()) {
  return { total: skills.length, promoted: skills.filter(isPromoted).length, backend: SKILLS_FILE ? 'file' : 'memory' }
}

/** 把一次脱敏上报并入技能库（去重聚合）。 */
async function ingest({ resourceKind, intent, toolSequence, outcome, src, tenant }, now) {
  const kind = KINDS.has(resourceKind) ? resourceKind : 'general'
  const lesson = String(intent || '').slice(0, 200)
  const tools = (Array.isArray(toolSequence) ? toolSequence : []).map((t) => String(t)).slice(0, 24)
  if (!lesson || !tools.length) return
  const vec = await embed(lesson)
  // 去重：同类 + 余弦≥SIM_MERGE + 工具 Jaccard≥TOOL_MERGE → 视为同一本质做法
  let best = null, bestSim = 0
  for (const s of skills) {
    if (s.resourceKind !== kind) continue
    const sim = cosine(vec, s.vec)
    if (sim >= SIM_MERGE && toolJaccard(tools, s.toolSequence) >= TOOL_MERGE && sim > bestSim) { best = s; bestSim = sim }
  }
  const seqKey = tools.join('>')
  if (best) {
    if (outcome === 'undone') best.undones += 1; else best.successes += 1
    if (src) best.sources.add(src)
    best.tenants.add(tenant)
    best.lastTs = now
    best.toolCounts[seqKey] = (best.toolCounts[seqKey] || 0) + 1
    // 代表工具链 = 出现最多的那条；代表经验文本取最近一次成功
    const top = Object.entries(best.toolCounts).sort((a, b) => b[1] - a[1])[0]
    if (top) best.toolSequence = top[0].split('>')
    if (outcome !== 'undone') { best.lesson = lesson; best.intent = shortIntent(lesson) }
  } else {
    skills.push({
      skillId: crypto.randomUUID(), resourceKind: kind, lesson, intent: shortIntent(lesson),
      toolSequence: tools, vec, toolCounts: { [seqKey]: 1 },
      successes: outcome === 'undone' ? 0 : 1, undones: outcome === 'undone' ? 1 : 0,
      sources: new Set(src ? [src] : []), tenants: new Set([tenant]), firstTs: now, lastTs: now,
    })
    if (skills.length > SKILLS_MAX) evictWorst(now) // 撑爆保护：超限就淘汰一条最差的（优先未晋级、低分）
  }
  markDirty()
  emit('skill_report', { kind, outcome, tenant })
}

// 淘汰一条「最差」技能：已晋级的给一个大基数尽量保留，其余按分数，最低者出局。
function evictWorst(now) {
  let idx = -1, worst = Infinity
  for (let i = 0; i < skills.length; i++) {
    const s = skills[i]
    const rank = (isPromoted(s) ? 1e6 : 0) + score(s, now)
    if (rank < worst) { worst = rank; idx = i }
  }
  if (idx >= 0) skills.splice(idx, 1)
}

const toSkill = (s, level = 'recipe', sc = 0) => ({ skillId: s.skillId, level, resourceKind: s.resourceKind, intent: s.intent, toolSequence: s.toolSequence, lesson: s.lesson, score: Math.round(sc * 100) / 100 })

/** 自底向上合成「套路」：同类高分 recipe ≥ PLAYBOOK_MIN 时，归纳出一条高层 playbook。
 *  这是轻量启发式（取最高分若干条的并集做步骤提示），真正的会话级序列合成留待 Phase 2。 */
function synthesizePlaybook(kind, promoted, now) {
  const pool = promoted.filter((x) => x.s.resourceKind === kind)
  if (pool.length < PLAYBOOK_MIN) return null
  const top = pool.slice(0, 5)
  const toolUnion = []
  for (const { s } of top) for (const t of s.toolSequence) if (!toolUnion.includes(t)) toolUnion.push(t)
  const steps = top.map(({ s }) => s.intent).filter(Boolean).slice(0, 4).join('；')
  return {
    skillId: `pb_${kind}`, level: 'playbook', resourceKind: kind,
    intent: `${kind} 常见成套做法`, toolSequence: toolUnion.slice(0, 12),
    lesson: `按步骤推进：${steps}`, score: Math.round((top[0]?.sc || 0) * 100) / 100 + 0.01,
  }
}

function topSkills(kind, k, now) {
  const promoted = skills.filter(isPromoted).map((s) => ({ s, sc: score(s, now) })).sort((a, b) => b.sc - a.sc)
  const want = KINDS.has(kind) ? kind : null
  const recipes = (want ? promoted.filter((x) => x.s.resourceKind === want) : promoted).slice(0, k).map((x) => toSkill(x.s, 'recipe', x.sc))
  const out = recipes
  if (want) { const pb = synthesizePlaybook(want, promoted, now); if (pb) out.unshift(pb) } // 套路置顶
  return out.slice(0, k + 1)
}

/** match：按查询 intent 语义召回（已晋级技能里取最相关 + 高分）。 */
async function matchSkills(kind, intent, k, now) {
  const want = KINDS.has(kind) ? kind : null
  const qv = await embed(String(intent || '').slice(0, 200))
  const promoted = skills.filter(isPromoted)
  const ranked = promoted
    .map((s) => ({ s, sim: cosine(qv, s.vec), sc: score(s, now) }))
    .filter((x) => x.sim >= 0.55 && (!want || x.s.resourceKind === want))
    .sort((a, b) => (b.sim * 0.6 + b.sc * 0.4) - (a.sim * 0.6 + a.sc * 0.4))
    .slice(0, k)
    .map((x) => toSkill(x.s, 'recipe', x.sc))
  return ranked
}

// ── 路由分发（与 HTTP 解耦，方便被 oauth 代理「单进程」挂载，也供单测调用）──────────
//   入参已解析好；出参 { status, json }。鉴权/CORS/IP/限流由宿主负责，tenant 由宿主传入。
export async function dispatchSkills({ method, pathname, searchParams, body, tenant = 'default', now = Date.now() }) {
  // 后缀匹配：oauthProxyUrl 可能带路径前缀(如 /feishu/oauth)，按结尾判断，不依赖绝对路径。
  if (method === 'GET' && pathname.endsWith('/skills/preload')) {
    const kind = (searchParams?.get?.('kind')) || 'general'
    return { status: 200, json: { skills: topSkills(kind, 4, now) } }
  }
  if (method === 'POST' && pathname.endsWith('/skills/report')) {
    try { await ingest({ ...(body || {}), tenant }, now) } catch (e) { console.error('[skills] ingest:', e?.message || e) }
    return { status: 200, json: { ok: true } }
  }
  if (method === 'POST' && pathname.endsWith('/skills/match')) {
    const k = Math.min(Math.max(Number(body?.k) || 4, 1), 8)
    return { status: 200, json: { skills: await matchSkills(body?.resourceKind, body?.intent, k, now) } }
  }
  return { status: 404, json: { error: 'not_found' } }
}
export { ingest, matchSkills, topSkills, load, persist, skills, isPromoted, score }

/** 把一个 Node http 请求接到 dispatchSkills 上（含 body 读取 + CORS/IP/限流/鉴权）。
 *  宿主（oauth 代理或独立 server）对 /skills/* 与 /healthz 调它；返回 true 表示已处理。 */
export function handleSkillHttp(req, res) {
  const url = new URL(req.url, 'http://x')
  if (!url.pathname.endsWith('/healthz') && !url.pathname.includes('/skills/')) return false
  const origin = req.headers.origin || ''
  const h = cors(origin)
  if (req.method === 'OPTIONS') { res.writeHead(204, h); res.end(); return true }
  if (req.method === 'GET' && url.pathname.endsWith('/healthz')) { send(res, 200, { ok: true, skills: skills.length }, h); return true }

  if (ALLOW_ORIGIN !== '*' && origin && origin !== ALLOW_ORIGIN) { send(res, 403, { error: 'origin_forbidden' }, h); return true }
  const ip = clientIp(req)
  if (IP_ALLOWLIST.length && !ipMatches(ip, IP_ALLOWLIST)) { send(res, 403, { error: 'ip_forbidden' }, h); return true }
  if (rateLimited(ip)) { send(res, 429, { error: 'rate_limited' }, h); return true }
  const auth = authTenant(req)
  if (!auth.ok) { send(res, auth.status, { error: auth.error }, h); return true }
  const now = Date.now()

  if (req.method === 'GET') {
    dispatchSkills({ method: 'GET', pathname: url.pathname, searchParams: url.searchParams, tenant: auth.tenant, now })
      .then((r) => send(res, r.status, r.json, h)).catch(() => send(res, 500, { error: 'internal' }, h))
    return true
  }
  if (req.method !== 'POST') { send(res, 405, { error: 'method_not_allowed' }, h); return true }
  let size = 0, chunks = ''
  req.on('data', (c) => { size += c.length; if (size > MAX_BODY) req.destroy(); else chunks += c })
  req.on('aborted', () => { if (!res.writableEnded) send(res, 413, { error: 'too_large' }, h) }) // 超限 → 干净的 413（而非裸断连）
  req.on('end', async () => {
    let body; try { body = JSON.parse(chunks || '{}') } catch { return send(res, 400, { error: 'bad_json' }, h) }
    const r = await dispatchSkills({ method: 'POST', pathname: url.pathname, body, tenant: auth.tenant, now })
    console.log(`[skills] ${new Date(now).toISOString()} ip=${ip} t=${auth.tenant} ${url.pathname} kind=${body?.resourceKind || '-'} ${body?.outcome || ''}`)
    send(res, r.status, r.json, h)
  })
  return true
}

// ── 独立运行（被 import 时不监听；直接 `node skill-proxy-server.mjs` 才起 server）──────
const runDirect = (process.argv[1] || '').endsWith('skill-proxy-server.mjs')
if (runDirect) {
  load()
  http.createServer((req, res) => { if (!handleSkillHttp(req, res)) send(res, 404, { error: 'not_found' }, cors(req.headers.origin || '')) })
    .listen(PORT, () => {
      console.log(`✓ 技能库代理已启动 :${PORT}`)
      console.log(`  ALLOW_ORIGIN=${ALLOW_ORIGIN}  多租户=${TENANT_KEYS.size || (SHARED_KEY ? '单租户' : '开放(仅联调)')}  IP白名单=${IP_ALLOWLIST.length || '(未设)'}  限流=${RATE_LIMIT}/min`)
      console.log(`  embedding=${EMBED_URL ? EMBED_MODEL : '内存假向量(未配 EMBED_URL)'}  落盘=${SKILLS_FILE || '(纯内存)'}  晋级阈值=${MIN_SOURCES}人/成功率${MIN_SUCCESS_RATE}`)
      if (ALLOW_ORIGIN === '*') console.warn('⚠ ALLOW_ORIGIN=* —— 仅联调。生产请锁 chrome-extension://<扩展ID>。')
      if (!EMBED_URL) console.warn('⚠ 未配 EMBED_URL —— 用内存假向量，语义聚类弱。生产请配 OpenAI 兼容 embedding 接口。')
    })
  process.on('SIGTERM', () => { persist(); process.exit(0) })
  process.on('SIGINT', () => { persist(); process.exit(0) })
}

/* ── systemd 示例（/etc/systemd/system/feishu-skill-proxy.service）─────────────
[Unit]
Description=Feishu Skill Proxy
After=network.target
[Service]
Environment=PORT=8788
Environment=ALLOW_ORIGIN=chrome-extension://<扩展ID>
Environment=PROXY_SHARED_KEY=<与扩展 VITE_OAUTH_PROXY_KEY 一致>
Environment=EMBED_URL=https://api.openai.com/v1/embeddings
Environment=EMBED_KEY=sk-xxx
Environment=EMBED_MODEL=text-embedding-3-small
Environment=SKILLS_FILE=/var/lib/feishu-skills/store.json
ExecStart=/usr/bin/node /opt/feishu-skill-proxy/skill-proxy-server.mjs
User=feishuproxy
Restart=on-failure
[Install]
WantedBy=multi-user.target
──────────────────────────────────────────────────────────────────────────── */
