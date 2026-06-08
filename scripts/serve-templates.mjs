/**
 * Local template registry server for testing the remote-fetch flow without GitHub.
 *
 *   node scripts/serve-templates.mjs            # serves on http://localhost:8787
 *   PORT=9000 node scripts/serve-templates.mjs
 *
 * Bundles public/templates/*.json into ONE file the extension can fetch in a single
 * request, then paste the printed URL into 设置 → 模板库地址.
 */
import { createServer } from 'node:http'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TPL_DIR = resolve(__dirname, '../public/templates')
const PORT = Number(process.env.PORT ?? 8787)

// Build a single bundle: { version, updated_at, templates: [full ScenarioTemplate...] }.
// Rebuilt on every request so editing a template shows up without restarting.
function buildBundle() {
  const index = JSON.parse(readFileSync(resolve(TPL_DIR, 'index.json'), 'utf8'))
  const files = readdirSync(TPL_DIR).filter((f) => f.endsWith('.json') && f !== 'index.json')
  const templates = files.map((f) => {
    const tpl = JSON.parse(readFileSync(resolve(TPL_DIR, f), 'utf8'))
    return { ...tpl, source: 'remote' }
  })
  return { version: index.version ?? '1.0.0', updated_at: index.updated_at ?? '', templates }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
}

const server = createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end() }
  try {
    const bundle = buildBundle()
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
    res.end(JSON.stringify(bundle, null, 2))
    console.log(`${new Date().toLocaleTimeString()}  ${req.method} ${req.url} → ${bundle.templates.length} 个模板`)
  } catch (err) {
    res.writeHead(500, CORS)
    res.end(JSON.stringify({ error: String(err) }))
    console.error('构建 bundle 失败:', err)
  }
})

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}/registry.json`
  const n = buildBundle().templates.length
  console.log('\n  📦 本地模板库已启动')
  console.log(`     模板数：${n}（来自 public/templates/）`)
  console.log('\n  👉 把下面这个地址粘贴到  设置 → 模板库地址：\n')
  console.log(`     ${url}\n`)
  console.log('  然后到「场景」Tab 点「🔄 从 GitHub 更新」即可拉取。改模板文件后刷新即可，无需重启。')
  console.log('  Ctrl+C 停止。\n')
})
