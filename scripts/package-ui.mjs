/**
 * 企业打包向导（本地 Web UI）—— 让不懂命令行的人也能 几下点出一个定制扩展包。
 *
 * 跑：node scripts/package-ui.mjs   （或 npm run package:ui）→ 浏览器开 http://localhost:8799
 * 在网页里：选模式 → 改名称/描述/图标 → 填参数(App ID/代理/LLM/开关) → 一键打包 → 下载 .zip。
 *
 * 实现：纯 Node http（零依赖；图标缩放用 devDep sharp，按需动态加载）。打包=驱动现有 `vite build`：
 *   1) 把表单写进【系统临时目录】里的 .env.local（敏感值只落在临时目录、用完即删，绝不进仓库）
 *   2) 用 PKG_ENV_DIR 指向该临时目录 → vite 只读它，绝不读你仓库里的 .env / .env.local
 *      （真·hermetic：产物【只含这次表单填的】，不串入本机任何 .env，也【完全不动】你的 .env.local）
 *   3) npm run build -- --mode package
 *   4) 后处理 dist/：覆盖 manifest 名称/描述、按上传 Logo 重生成图标（不动源文件）
 *   5) zip dist/ → 下载
 * 只在 127.0.0.1 监听（本机工具，不对外）。/api/build 串行（同一时间只跑一个，避免共享 dist/ 互相污染）。
 */
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT || 8799)
const HTML = (() => { try { return fs.readFileSync(new URL('./package-ui.html', import.meta.url), 'utf8') } catch { return '<h1>package-ui.html missing</h1>' } })()
const DIST = path.join(ROOT, 'dist')
const ZIP = path.join(ROOT, 'feishu-package.zip')

// CSRF / DNS-重绑定防护：本机工具，只接受来自自身 loopback 源的请求。恶意网页虽能让浏览器发跨站
// 请求，但拿不到我们这台服务器的 Host/Origin，也无法用 application/json 免预检（见下 isJson）。
const SELF_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`])
const SELF_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`])
const originOk = (req) => {
  if (!SELF_HOSTS.has(req.headers.host)) return false       // 防 DNS 重绑定：Host 必须是本机:端口
  const o = req.headers.origin                               // 防 CSRF：带跨站 Origin 的一律拒
  return !o || SELF_ORIGINS.has(o)
}
// 状态变更端点强制 application/json：跨站请求一旦带它就会触发 CORS 预检，而本服务器无 CORS 头 → 浏览器拦下。
const isJson = (req) => (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() === 'application/json'

const send = (res, status, obj, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(type === 'application/json' ? JSON.stringify(obj) : obj)
}
const readBody = (req) => new Promise((resolve) => {
  let n = 0; const parts = []
  req.on('data', (c) => { n += c.length; if (n > 24 * 1024 * 1024) req.destroy(); else parts.push(c) })
  req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')) } catch { resolve(null) } })
  req.on('error', () => resolve(null))
})
const run = (cmd, args, opts = {}) => new Promise((resolve) => {
  let log = ''
  const p = spawn(cmd, args, { cwd: ROOT, shell: process.platform === 'win32', ...opts })
  p.stdout.on('data', (d) => (log += d))
  p.stderr.on('data', (d) => (log += d))
  p.on('close', (code) => resolve({ code, log }))
  p.on('error', (e) => resolve({ code: -1, log: log + '\n' + (e?.message || e) }))
})

// ── 表单 → .env 内容 ──────────────────────────────────────────────────────────
export const PKG_MODES = ['enterprise', 'personal', 'store', 'private']

export function envFromConfig(c) {
  const L = []
  // 值里若含换行会注入额外 env 行（翻 VITE_NO_REMOTE_CODE / 注入 secret 等）——一律去掉 CR/LF。
  const clean = (v) => String(v).replace(/[\r\n]+/g, ' ').trim()
  const put = (k, v) => { if (v !== undefined && v !== null && v !== '' && v !== false) L.push(`${k}=${v === true ? '1' : clean(v)}`) }
  // mode 必须收敛到白名单：否则含换行的 mode 会注入到下面的注释行 → 伪造任意 VITE_* 行（绕过 put 的 clean）。
  const mode = PKG_MODES.includes(c.mode) ? c.mode : 'enterprise'
  L.push(`# 由打包向导生成 · 模式=${clean(mode)} · 仅存系统临时目录、用完即删`)
  if (mode === 'store') {
    put('VITE_WEBSTORE', 1) // 剥 manifest key + BYO（凭据/代理在 config.ts 被强制清空）
    // 商店版名称/摘要走 vite 单一管线(transformManifest 读 VITE_STORE_NAME/_DESC)，避免与后处理双写、
    // 且用户不填时保留商标安全默认值（"…第三方…"）。
    put('VITE_STORE_NAME', c.name)
    put('VITE_STORE_DESC', c.desc)
  }
  // 凭据 / 连接
  if (mode === 'personal' || mode === 'private') {
    put('VITE_FEISHU_APP_ID', c.appId)
    if (c.appSecretEnc) put('VITE_FEISHU_APP_SECRET_ENC', c.appSecretEnc)
    else put('VITE_FEISHU_APP_SECRET', c.appSecret)
  }
  if (mode === 'enterprise' || (mode === 'private' && c.proxyUrl)) {
    put('VITE_OAUTH_PROXY_URL', c.proxyUrl)
    put('VITE_OAUTH_PROXY_KEY', c.proxyKey)
    put('VITE_APP_ID_FROM_PROXY', !!c.appIdFromProxy)
    if (!c.appIdFromProxy) put('VITE_FEISHU_APP_ID', c.appId)
  }
  if (mode === 'private') put('VITE_FEISHU_BASE_DOMAIN', c.baseDomain)
  // 企业能力 / 托管 LLM 开关：勾了就如实写入——不再被"有没有填代理"误吞（修：UI 在私有化模式
  // 显示这些勾选框却静默丢弃用户选择）。注：技能库/云备份在 config.ts 仍需 oauthProxyUrl 才真正
  // 激活(HAS_SKILLS/HAS_ARTIFACT_SYNC)，这里只如实记录用户意图，不会凭空生效。
  if (mode === 'enterprise' || mode === 'private') {
    put('VITE_ENTERPRISE_POLICY', !!c.policy)
    put('VITE_SKILLS_ENABLED', !!c.skills)
    put('VITE_ARTIFACT_SYNC', !!c.artifacts)
    put('VITE_LLM_FROM_PROXY', !!c.llmFromProxy)
    put('VITE_LLM_LOCK_MANAGED', !!c.llmLock)
  }
  put('VITE_LLM_NO_PERSIST', !!c.llmNoPersist)
  // 通用安全/LLM
  put('VITE_OPENAI_ALLOWED_HOSTS', c.allowedHosts)
  put('VITE_LLM_REDACT', !!c.redact)
  put('VITE_LLM_MAX_PAYLOAD_CHARS', c.maxPayload)
  put('VITE_MAX_TOOL_CALLS', c.maxToolCalls)
  put('VITE_NO_REMOTE_CODE', !!c.noRemoteCode)
  put('VITE_FEISHU_OAUTH_SCOPE', c.oauthScope)
  put('VITE_ALLOWED_CIDRS', c.allowedCidrs)
  return L.join('\n') + '\n'
}

// 出包前校验：拦下"打出来根本登录不了"的死包（修：private 取消"App ID 从代理下发"又不填 App ID 时，
// 原来会静默出一个无凭据来源的包，构建还报成功）。商店/BYO 版由用户安装后在设置里自填，无需内置。
export function validateConfig(c) {
  const mode = c.mode || 'enterprise'
  if (!PKG_MODES.includes(mode)) return '未知打包模式：' + String(c.mode).slice(0, 40)
  if (mode === 'store') return null
  const viaProxy = (mode === 'enterprise' || mode === 'private') && !!c.appIdFromProxy && !!(c.proxyUrl && String(c.proxyUrl).trim())
  const hasAppId = !!(c.appId && String(c.appId).trim()) || viaProxy
  if (!hasAppId) return '缺少 App ID：请填飞书 App ID，或（企业/私有化）勾选「App ID 从代理下发」并填代理地址。商店版无需内置 App ID。'
  return null
}

// 后处理 dist：改名称/描述、(可选)剥 key、按 Logo 重生成图标
async function customizeDist(c) {
  const mode = c.mode || 'enterprise'
  const mfPath = path.join(DIST, 'manifest.json')
  const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'))
  // 商店模式：名称/描述已由 vite transformManifest 按 VITE_STORE_NAME/_DESC 写好（单一管线 + 商标安全
  // 默认值），这里不再二次覆盖以免双写漂移、覆盖掉安全默认值。其余模式 vite 不改名，这里补上。
  if (mode !== 'store') {
    if (c.name) { mf.name = c.name; if (mf.action) mf.action.default_title = c.name }
    if (c.desc) mf.description = c.desc
  }
  if (c.stripKey) delete mf.key
  fs.writeFileSync(mfPath, JSON.stringify(mf, null, 2))
  let warn = ''
  // 图标：上传的是 dataURL（PNG）→ sharp 缩到 16/32/48/128 覆盖 dist/icons（不动 public/ 源）
  if (c.logoDataUrl && /^data:image\//.test(c.logoDataUrl)) {
    try {
      const buf = Buffer.from(String(c.logoDataUrl).split(',')[1] || '', 'base64')
      const sharp = (await import('sharp')).default
      const dir = path.join(DIST, 'icons'); fs.mkdirSync(dir, { recursive: true })
      for (const s of [16, 32, 48, 128]) await sharp(buf).resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(dir, `icon${s}.png`))
    } catch (e) {
      // sharp 是可选原生依赖；缺失/损坏不应让整个打包失败——保留默认图标，其余照常完成。
      warn = `⚠ 自定义图标未应用（sharp 不可用：${e?.message || e}）。已保留默认图标，其余打包成功。`
    }
  }
  return { name: mf.name, version: mf.version, description: mf.description, warn }
}

let lastZip = null
async function doBuild(c) {
  const err = validateConfig(c)
  if (err) return { ok: false, log: err, invalid: true }
  // hermetic：把表单写进【系统临时目录】的 .env.local，并用 PKG_ENV_DIR 指向它 → vite 只读这个目录的
  // .env*，完全不碰你仓库里的 .env / .env.local（用完即删）。这样既不串入本机其它 .env，也不会因为
  // 中途 Ctrl-C 把你的 .env.local 弄丢。
  const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-pkg-'))
  let log = ''
  try {
    fs.writeFileSync(path.join(envDir, '.env.local'), envFromConfig(c))
    const b = await run('npm', ['run', 'build', '--', '--mode', 'package'], { env: { ...process.env, PKG_ENV_DIR: envDir } })
    log += b.log
    if (b.code !== 0) return { ok: false, log }
    const meta = await customizeDist(c)
    if (meta.warn) log += '\n' + meta.warn
    fs.rmSync(ZIP, { force: true })
    const z = await run('zip', ['-qr', ZIP, '.'], { cwd: DIST })
    log += z.log
    if (z.code !== 0) return { ok: false, log: log + '\n⚠ 未找到 zip 命令（Windows 可手动压缩 dist/）。dist/ 已生成可直接加载。', meta, distOnly: true }
    lastZip = ZIP
    return { ok: true, log, meta, zip: path.basename(ZIP), size: fs.statSync(ZIP).size }
  } finally {
    fs.rmSync(envDir, { recursive: true, force: true }) // 删掉含明文凭据的临时 env 目录
  }
}

let building = false // /api/build 串行锁——两次打包争用同一个 dist/ 会产出混包
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  // 跨站 / DNS 重绑定防护：拒掉非本机源的请求（修 CSRF——恶意网页静默触发打包、投毒 dist/zip）。
  if (!originOk(req)) return send(res, 403, { error: 'forbidden' })
  if (req.method === 'GET' && url.pathname === '/') return send(res, 200, HTML, 'text/html')
  if (req.method === 'POST' && url.pathname === '/api/preview') {
    if (!isJson(req)) return send(res, 415, { error: 'content_type' })
    const c = await readBody(req); if (!c) return send(res, 400, { error: 'bad' })
    return send(res, 200, { env: envFromConfig({ ...c, logoDataUrl: undefined }) })
  }
  if (req.method === 'POST' && url.pathname === '/api/build') {
    if (!isJson(req)) return send(res, 415, { ok: false, log: '需要 Content-Type: application/json' })
    const c = await readBody(req); if (!c) return send(res, 400, { error: 'bad' })
    if (building) return send(res, 409, { ok: false, log: '已有一个打包正在进行——请等它完成再试（两次打包会争用同一个 dist/，产出混包）。' })
    building = true
    try { return send(res, 200, await doBuild(c)) }
    catch (e) { return send(res, 500, { ok: false, log: String(e?.message || e) }) }
    finally { building = false }
  }
  if (req.method === 'GET' && url.pathname === '/api/download') {
    if (!lastZip || !fs.existsSync(lastZip)) return send(res, 404, { error: 'no_package' })
    const stream = fs.createReadStream(lastZip)
    // 并发重建可能在读流中途 rm/重写 zip → ENOENT/EBUSY。必须挂 error 处理，否则未捕获的 stream
    // error 会抛成 uncaughtException 直接崩掉整个向导进程。
    stream.on('error', () => { try { if (!res.headersSent) res.writeHead(500); res.end() } catch { /* already torn down */ } })
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="feishu-extension.zip"' })
    return stream.pipe(res)
  }
  send(res, 404, { error: 'not_found' })
})

// 仅当作为脚本直接运行时才监听端口；被测试 import 时不起服务。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`✓ 打包向导已启动 → http://localhost:${PORT}`)
    console.log('  在浏览器里：选模式 → 改名称/图标 → 填参数 → 一键打包 → 下载 .zip。仅本机可访问。')
  })
}
