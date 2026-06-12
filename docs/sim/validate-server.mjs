/**
 * 服务端能力验证器（无需真飞书 / 真对象存储）——用【合成数据】把整条服务端 HTTP 端到端压一遍。
 *
 * 做法：本进程内起一个【假飞书】(user_info / oauth token) + 【概念向量 embedding 桩]，再 spawn 真正的
 * oauth 代理（它会挂载技能库 / 云备份 / 管理台），让代理把出站请求打到假飞书。然后用真实 HTTP 调用，
 * 造一批多用户 / 多主题的数据，逐项断言：
 *   技能库：语义去重、热度计数、打分、晋级阈值、撤销抑制、匹配召回、套路自合成
 *   云备份：往返、按 open_id 隔离、AES 静态加密(读盘验证密文)、外租户拒绝
 *   OAuth ：app_config(无token) / llm_config(租户校验) / policy / 换 token 透传
 *   管理台：登录(错/对)、鉴权、总览指标、技能审核(强制/删)、备份列删、审计流
 *
 * 运行：node docs/sim/validate-server.mjs   （零依赖，Node ≥ 18）。全过 → 退出码 0，有失败 → 1。
 */
import http from 'node:http'
import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const PROXY = path.join(DIR, '..', 'oauth-proxy-server.mjs')

// ── 迷你断言框架 ──────────────────────────────────────────────────────────────
let pass = 0, fail = 0
const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', y: '\x1b[33m', x: '\x1b[0m', b: '\x1b[1m' }
const group = (t) => console.log(`\n${C.b}═══ ${t} ═══${C.x}`)
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ${C.g}✅${C.x} ${name}`) }
  else { fail++; console.log(`  ${C.r}❌ ${name}${C.x}${extra ? `  ${C.d}(${extra})${C.x}` : ''}`) }
}

// ── 合成数据：30 个本租户用户 + 1 个外租户 ────────────────────────────────────────
const TENANT = 'tk_sim'
const users = {}
for (let i = 0; i < 30; i++) users['utok_' + i] = { open_id: 'ou_' + i, tenant_key: TENANT, name: '用户' + i }
users['utok_evil'] = { open_id: 'ou_evil', tenant_key: 'tk_other', name: '外人' }

// ── 概念向量 embedding 桩：按概念词出现与否编码；最后一维是「无概念」兜底（让乱写查询正交）──
const CONCEPTS = ['分类', '求和', '柱状图', '关联', '跨表', '明细', '日期', '折线', '趋势', '去重', '清洗', '计数', '饼图', '汇总', '看板', '占比', '筛选', '排序', '透视', '分组']
function embed(text) {
  const v = CONCEPTS.map((c) => (String(text).includes(c) ? 1 : 0))
  v.push(0)
  if (v.reduce((a, b) => a + b, 0) === 0) v[v.length - 1] = 1 // 无概念 → 正交兜底维
  const n = Math.hypot(...v) || 1
  return v.map((x) => x / n)
}

// ── 主题（每条改写都恰含其 3 个核心概念、不含其它概念词；同主题→余弦1，跨主题→≤0.33）──
const TOPICS = [
  { kind: 'base', tools: ['list_fields', 'search_records', 'render_data_app'], phr: ['把数据按分类做求和然后柱状图展示', '分类求和的柱状图', '按分类求和结果用柱状图'] },
  { kind: 'base', tools: ['list_tables', 'search_records', 'create_spreadsheet'], phr: ['多表关联做跨表的明细', '关联跨表的明细结果', '把表关联起来跨表看明细'] },
  { kind: 'base', tools: ['search_records', 'render_data_app'], phr: ['按日期的折线趋势', '日期折线看趋势', '折线按日期展示趋势'] },
  { kind: 'sheet', tools: ['read_range', 'feishu_api_call'], phr: ['明细去重清洗', '清洗明细做去重', '去重清洗明细数据'] },
  { kind: 'sheet', tools: ['search_records', 'render_data_app'], phr: ['按分类计数的饼图', '分类计数用饼图', '饼图展示分类计数'] },
  { kind: 'doc', tools: ['list_blocks', 'render_data_app'], phr: ['汇总看板看占比', '看板汇总占比', '占比汇总的看板'] },
  { kind: 'base', tools: ['search_records', 'create_spreadsheet'], phr: ['筛选排序明细', '明细筛选后排序', '按筛选排序明细'] },
  { kind: 'base', tools: ['search_records', 'render_data_app'], phr: ['透视分组汇总', '分组汇总透视', '透视的分组汇总'] },
]
const phrase = (t, i) => TOPICS[t].phr[i % TOPICS[t].phr.length]

// ── 假飞书 + embedding 桩（本进程 http 服务）──────────────────────────────────────
function startFake() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const j = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) }
        if (req.url.endsWith('/authen/v1/user_info')) {
          const tok = (req.headers.authorization || '').replace('Bearer ', '')
          const u = users[tok]
          return u ? j({ code: 0, data: u }) : j({ code: 99991663, msg: 'invalid token' })
        }
        if (req.url.endsWith('/authen/v2/oauth/token')) {
          return j({ access_token: 'u-faketoken', refresh_token: 'r-fake', expires_in: 7200, token_type: 'Bearer' })
        }
        if (req.url.endsWith('/embed')) {
          let input = ''
          try { input = (JSON.parse(body).input || [''])[0] } catch { /* */ }
          return j({ data: [{ embedding: embed(input) }] })
        }
        res.writeHead(404); res.end('{}')
      })
    })
    srv.listen(0, () => resolve({ srv, port: srv.address().port }))
  })
}
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)) }) })

async function waitHealthz(base, ms = 8000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(base + '/healthz'); if (r.ok) return true } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 120))
  }
  throw new Error('proxy 未就绪')
}

// ── 主流程 ────────────────────────────────────────────────────────────────────
const { srv: fake, port: F } = await startFake()
const PORT = await freePort()
const base = 'http://127.0.0.1:' + PORT
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-sim-'))
const ENC_KEY = crypto.randomBytes(32).toString('hex')

const childEnv = {
  ...process.env,
  FEISHU_APP_ID: 'cli_sim', FEISHU_APP_SECRET: 'sim_secret',
  FEISHU_API_BASE: `http://127.0.0.1:${F}/open-apis`, FEISHU_TENANT_KEY: TENANT,
  EMBED_URL: `http://127.0.0.1:${F}/embed`, EMBED_KEY: 'sim', EMBED_MODEL: 'sim',
  ARTIFACTS_DIR: tmp, ARTIFACT_ENC_KEY: ENC_KEY,
  ADMIN_PASSWORD: 'simpass',
  MIN_SOURCES: '3', MIN_SUCCESS_RATE: '0.6', PLAYBOOK_MIN: '3', SIM_MERGE: '0.86',
  LLM_BASE_URL: 'http://sim-llm/v1', LLM_API_KEY: 'sk-simkey', LLM_MODEL: 'sim-model',
  ALLOWED_REDIRECT_URIS: 'http://sim/redirect', ALLOWED_CLIENT_IDS: 'cli_sim',
  ALLOW_ORIGIN: '*', PORT: String(PORT),
}
const child = spawn('node', [PROXY], { env: childEnv, stdio: ['ignore', 'ignore', 'pipe'] })
let childErr = ''
child.stderr.on('data', (d) => (childErr += d))

const post = async (p, body, headers = {}) => { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => ({})) } }
const get = async (p, headers = {}) => { const r = await fetch(base + p, { headers }); return { status: r.status, json: await r.json().catch(() => ({})) } }
const report = (t, src, outcome = 'success') => post('/skills/report', { resourceKind: TOPICS[t].kind, intent: phrase(t, src.length), toolSequence: TOPICS[t].tools, outcome, src })

let exitCode = 1
try {
  await waitHealthz(base)

  // ════ 技能库 ════
  group('技能库：去重 · 热度 · 打分 · 晋级 · 匹配 · 套路')
  // 主题0：3 个不同贡献者的改写 → 应合并成 1 条并晋级
  await report(0, 'srcA'); await report(0, 'srcB'); await report(0, 'srcCC')
  // 主题1：仅 2 个贡献者 → 候选，未晋级
  await report(1, 'srcA'); await report(1, 'srcB')
  // 主题2、6、7：各 3 贡献者(base) → 晋级，凑够 PLAYBOOK_MIN 让 base 合成套路
  for (const t of [2, 6, 7]) for (const s of ['s1', 's2', 's33']) await report(t, s + 't' + t)
  // 主题3：3 贡献者但多为 undone → 成功率<0.6，不晋级
  await report(3, 'u1', 'undone'); await report(3, 'u2', 'undone'); await report(3, 'u3', 'success')

  // 每个主题取一个【唯一】概念词作标识（代表 intent 取自最近一条改写，但都含本主题核心概念）。
  const MARK = ['柱状图', '跨表', '折线', '去重', '饼图', '看板', '筛选', '透视']
  const adminTok = (await post('/admin/api/login', { password: 'simpass' })).json.token
  const all = (await get('/admin/api/skills', { Authorization: 'Bearer ' + adminTok })).json.skills || []
  const find = (t) => all.filter((s) => s.intent.includes(MARK[t]))
  const s0 = find(0)[0]
  ok('主题0 的 3 条改写语义去重为 1 条', find(0).length === 1, `实得 ${find(0).length}`)
  ok('去重后 distinctSources = 3（热度计数）', s0 && s0.sources === 3, `sources=${s0?.sources}`)
  ok('达标技能被晋级(promoted)', !!s0?.promoted)
  const s1 = find(1)[0]
  ok('仅 2 贡献者的主题1 不晋级(候选)', s1 && s1.sources === 2 && !s1.promoted, `sources=${s1?.sources} promoted=${s1?.promoted}`)
  const s3 = find(3)[0]
  ok('多撤销(undone)的主题3 成功率<0.6 不晋级', s3 && !s3.promoted, `succ=${s3?.successes} undone=${s3?.undones} promoted=${s3?.promoted}`)
  const reportedTopics = new Set([0, 1, 2, 6, 7, 3]) // 6 个不同主题（即便 2/7 工具链相同，按语义也是两条）
  ok('技能条数 = 不同主题数（而非上报次数）', all.length === reportedTopics.size, `skills=${all.length} topics=${reportedTopics.size}`)

  // 匹配召回
  const m1 = (await post('/skills/match', { resourceKind: 'base', intent: '我想把数据按分类求和画个柱状图', k: 4 })).json.skills || []
  ok('匹配：相关查询召回到主题0 技能', m1.length > 0 && m1[0].toolSequence.join('>') === TOPICS[0].tools.join('>'), `n=${m1.length}`)
  const m2 = (await post('/skills/match', { resourceKind: 'base', intent: 'zzz 随便乱写 qwer 没有任何概念', k: 4 })).json.skills || []
  ok('匹配：无关查询返回空（不乱召回）', m2.length === 0, `n=${m2.length}`)

  // 套路自合成
  const pre = (await get('/skills/preload?kind=base')).json.skills || []
  ok('预加载：base 高分够多 → 合成出「套路」(playbook)', pre.some((s) => s.level === 'playbook'))

  // ════ 云备份 ════
  group('云备份：往返 · 按 open_id 隔离 · AES 静态加密 · 外租户拒绝')
  const put0 = await post('/artifacts/put', { user_access_token: 'utok_0', kind: 'dataviz', items: [{ id: 'v1', name: '看板A', createdAt: 2 }, { id: 'v2', name: '网站B', createdAt: 1 }] })
  ok('用户0 备份 dataviz 成功 n=2', put0.json.ok && put0.json.n === 2)
  const pull0 = await post('/artifacts/pull', { user_access_token: 'utok_0', kind: 'dataviz' })
  ok('用户0 拉回 2 条（往返一致）', (pull0.json.items || []).length === 2 && pull0.json.items[0].name === '看板A')
  const pull1 = await post('/artifacts/pull', { user_access_token: 'utok_1', kind: 'dataviz' })
  ok('用户1 拉取为空（按 open_id 隔离，读不到用户0）', (pull1.json.items || []).length === 0)
  const onDisk = fs.readFileSync(path.join(tmp, TENANT, 'ou_0', 'dataviz.json'))
  ok('落盘内容是密文（AES-GCM，非明文 JSON）', onDisk[0] !== 0x5b /* '[' */ && !onDisk.toString('utf8', 0, 8).includes('看板'))
  const evil = await post('/artifacts/put', { user_access_token: 'utok_evil', kind: 'dataviz', items: [] })
  ok('外租户 token 备份被拒(403 not_in_tenant)', evil.status === 403 && evil.json.error === 'not_in_tenant', `status=${evil.status}`)

  // ════ OAuth 各 grant ════
  group('OAuth：app_config(无token) · llm_config(租户校验) · policy · 换 token 透传')
  const ac = await post('/', { grant_type: 'app_config' })
  ok('app_config 无需 token 返回 App ID', ac.json.app_id === 'cli_sim')
  const lc = await post('/', { grant_type: 'llm_config', user_access_token: 'utok_5' })
  ok('llm_config：本租户成员拿到企业 LLM 配置', lc.json.base_url === 'http://sim-llm/v1' && lc.json.api_key === 'sk-simkey')
  const lcEvil = await post('/', { grant_type: 'llm_config', user_access_token: 'utok_evil' })
  ok('llm_config：外租户被拒(403 not_in_tenant)', lcEvil.status === 403 && lcEvil.json.error === 'not_in_tenant')
  const pol = await post('/', { grant_type: 'policy', user_access_token: 'utok_5' })
  ok('policy：本租户成员拿到策略对象', !!pol.json.policy)
  const tok = await post('/', { grant_type: 'authorization_code', code: 'c1', redirect_uri: 'http://sim/redirect', client_id: 'cli_sim' })
  ok('换 token：经代理注入 secret 后透传上游 token', tok.json.access_token === 'u-faketoken')
  const tokBad = await post('/', { grant_type: 'authorization_code', code: 'c1', redirect_uri: 'http://evil/cb', client_id: 'cli_sim' })
  ok('换 token：未在白名单的 redirect_uri 被拒', tokBad.json.error === 'redirect_uri_forbidden')

  // ════ 管理台 ════
  group('管理台：登录 · 鉴权 · 总览 · 审核 · 备份管理 · 审计')
  ok('登录：错密码 401', (await post('/admin/api/login', { password: 'wrong' })).status === 401)
  ok('鉴权：无 token 调 API → 401', (await get('/admin/api/skills')).status === 401)
  const A = { Authorization: 'Bearer ' + adminTok }
  const ov = (await get('/admin/api/overview', A)).json
  ok('总览：技能/备份指标可读', ov.skills?.total > 0 && ov.artifacts?.backend === 'FS')
  ok('配置巡检：App Secret 已脱敏(打码)', /^\*{4}/.test(ov.config?.oauth?.app_secret || ''))
  const sid = s0.skillId
  await post('/admin/api/skills/force', { skillId: sid, force: 'demoted' }, A)
  const afterForce = ((await get('/admin/api/skills', A)).json.skills || []).find((s) => s.skillId === sid)
  ok('审核：强制降级生效', afterForce && afterForce.forced === 'demoted' && !afterForce.promoted)
  ok('审核：删除技能生效', (await post('/admin/api/skills/delete', { skillId: sid }, A)).json.ok && !((await get('/admin/api/skills', A)).json.skills || []).some((s) => s.skillId === sid))
  const arts = (await get('/admin/api/artifacts', A)).json.artifacts || []
  const mine = arts.find((a) => a.openId === 'ou_0' && a.kind === 'dataviz')
  ok('备份管理：列出用户0 的 dataviz 对象', !!mine && mine.size > 0)
  ok('备份管理：删除对象后用户拉取为空', (await post('/admin/api/artifacts/delete', { key: mine.key }, A)).json.ok &&
    ((await post('/artifacts/pull', { user_access_token: 'utok_0', kind: 'dataviz' })).json.items || []).length === 0)
  const audit = (await get('/admin/api/audit', A)).json.audit || []
  ok('审计：记录到换 token / llm_config / 技能 / 备份 等事件', audit.length > 5 &&
    audit.some((e) => e.action?.startsWith('token:')) && audit.some((e) => e.module === 'skills') && audit.some((e) => e.module === 'artifacts'))

  exitCode = fail === 0 ? 0 : 1
} catch (e) {
  console.error(`\n${C.r}运行异常：${e?.message || e}${C.x}`)
  if (childErr) console.error(C.d + '代理 stderr：\n' + childErr.slice(0, 800) + C.x)
} finally {
  child.kill()
  fake.close()
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* */ }
}

console.log(`\n${C.b}━━━ 结果：${C.g}${pass} 通过${C.x}${C.b} / ${fail ? C.r : ''}${fail} 失败${C.x}${C.b} ━━━${C.x}`)
process.exit(exitCode)
