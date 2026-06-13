/**
 * 企业打包向导（本地 Web UI）—— 让不懂命令行的人也能 几下点出一个定制扩展包。
 *
 * 跑：node scripts/package-ui.mjs   （或 npm run package:ui）→ 浏览器开 http://localhost:8799
 * 在网页里：选模式 → 改名称/描述/图标 → 填参数(App ID/代理/LLM/开关) → 一键打包 → 下载 .zip。
 *
 * 实现：纯 Node http（零依赖；图标缩放用 devDep sharp，按需动态加载）。打包=驱动现有 `vite build`：
 *   1) 把表单写成 .env.package.local（敏感值只落在本机这个 gitignore 文件）
 *   2) 临时把你的 .env.local 挪开 → 保证打出来的包【只含你这次填的】，不串入本机개发配置
 *   3) npm run build -- --mode package
 *   4) 后处理 dist/：覆盖 manifest 名称/描述、按上传 Logo 重生成图标（不动源文件）
 *   5) zip dist/ → 下载
 * 只在 127.0.0.1 监听（本机工具，不对外）。
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT || 8799)
const HTML = (() => { try { return fs.readFileSync(new URL('./package-ui.html', import.meta.url), 'utf8') } catch { return '<h1>package-ui.html missing</h1>' } })()
const DIST = path.join(ROOT, 'dist')
const ZIP = path.join(ROOT, 'feishu-package.zip')

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
function envFromConfig(c) {
  const L = []
  const put = (k, v) => { if (v !== undefined && v !== null && v !== '' && v !== false) L.push(`${k}=${v === true ? '1' : String(v)}`) }
  const mode = c.mode || 'enterprise'
  L.push(`# 由打包向导生成 · 模式=${mode} · 本文件已被 .gitignore`)
  if (mode === 'store') put('VITE_WEBSTORE', 1) // 剥 manifest key + BYO（凭据/代理在 config.ts 被强制清空）
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
    put('VITE_LLM_FROM_PROXY', !!c.llmFromProxy)
    put('VITE_LLM_LOCK_MANAGED', !!c.llmLock)
    put('VITE_LLM_NO_PERSIST', !!c.llmNoPersist)
    put('VITE_ENTERPRISE_POLICY', !!c.policy)
    put('VITE_SKILLS_ENABLED', !!c.skills)
    put('VITE_ARTIFACT_SYNC', !!c.artifacts)
  }
  if (mode === 'private') put('VITE_FEISHU_BASE_DOMAIN', c.baseDomain)
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

// 后处理 dist：改名称/描述、(可选)剥 key、按 Logo 重生成图标
async function customizeDist(c) {
  const mfPath = path.join(DIST, 'manifest.json')
  const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'))
  if (c.name) { mf.name = c.name; if (mf.action) mf.action.default_title = c.name }
  if (c.desc) mf.description = c.desc
  if (c.stripKey) delete mf.key
  fs.writeFileSync(mfPath, JSON.stringify(mf, null, 2))
  // 图标：上传的是 dataURL（PNG）→ sharp 缩到 16/32/48/128 覆盖 dist/icons（不动 public/ 源）
  if (c.logoDataUrl && /^data:image\//.test(c.logoDataUrl)) {
    const buf = Buffer.from(c.logoDataUrl.split(',')[1], 'base64')
    const sharp = (await import('sharp')).default
    const dir = path.join(DIST, 'icons'); fs.mkdirSync(dir, { recursive: true })
    for (const s of [16, 32, 48, 128]) await sharp(buf).resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(dir, `icon${s}.png`))
  }
  return { name: mf.name, version: mf.version, description: mf.description }
}

let lastZip = null
async function doBuild(c) {
  fs.writeFileSync(path.join(ROOT, '.env.package.local'), envFromConfig(c))
  // 临时挪开 .env.local，保证 hermetic（只用本次表单）；finally 还原
  const local = path.join(ROOT, '.env.local'); const bak = path.join(ROOT, '.env.local.__pkgbak__')
  const moved = fs.existsSync(local)
  if (moved) fs.renameSync(local, bak)
  let log = ''
  try {
    const b = await run('npm', ['run', 'build', '--', '--mode', 'package'])
    log += b.log
    if (b.code !== 0) return { ok: false, log }
    const meta = await customizeDist(c)
    fs.rmSync(ZIP, { force: true })
    const z = await run('zip', ['-qr', ZIP, '.'], { cwd: DIST })
    log += z.log
    if (z.code !== 0) return { ok: false, log: log + '\n⚠ 未找到 zip 命令（Windows 可手动压缩 dist/）。dist/ 已生成可直接加载。', meta, distOnly: true }
    lastZip = ZIP
    return { ok: true, log, meta, zip: path.basename(ZIP), size: fs.statSync(ZIP).size }
  } finally {
    if (moved && fs.existsSync(bak)) fs.renameSync(bak, local)
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  if (req.method === 'GET' && url.pathname === '/') return send(res, 200, HTML, 'text/html')
  if (req.method === 'POST' && url.pathname === '/api/preview') {
    const c = await readBody(req); if (!c) return send(res, 400, { error: 'bad' })
    return send(res, 200, { env: envFromConfig({ ...c, logoDataUrl: undefined }) })
  }
  if (req.method === 'POST' && url.pathname === '/api/build') {
    const c = await readBody(req); if (!c) return send(res, 400, { error: 'bad' })
    try { return send(res, 200, await doBuild(c)) } catch (e) { return send(res, 500, { ok: false, log: String(e?.message || e) }) }
  }
  if (req.method === 'GET' && url.pathname === '/api/download') {
    if (!lastZip || !fs.existsSync(lastZip)) return send(res, 404, { error: 'no_package' })
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="feishu-extension.zip"' })
    return fs.createReadStream(lastZip).pipe(res)
  }
  send(res, 404, { error: 'not_found' })
})
server.listen(PORT, '127.0.0.1', () => {
  console.log(`✓ 打包向导已启动 → http://localhost:${PORT}`)
  console.log('  在浏览器里：选模式 → 改名称/图标 → 填参数 → 一键打包 → 下载 .zip。仅本机可访问。')
})
