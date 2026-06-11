/**
 * Automated RENDER test: boots dev:ui, loads the sandbox page, posts a DATAVIZ_RENDER for each
 * VizSpec kind (the Plan B no-eval path) with sample data, and ASSERTS the DOM actually rendered
 * content — catches "blank / broken render" regressions (charts/dashboards/sites/slides) without
 * any real Feishu. Exits non-zero on any failure or page error.
 *   node scripts/render-test.mjs
 */
import { spawn } from 'node:child_process'
import puppeteer from 'puppeteer'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const rows = [
  { 区域: '华东', 产品: '专业版', 销售额: '12000', 状态: '已完成' },
  { 区域: '华东', 产品: '企业版', 销售额: '30000', 状态: '进行中' },
  { 区域: '华南', 产品: '基础版', 销售额: '5000', 状态: '已完成' },
  { 区域: '华北', 产品: '企业版', 销售额: '28000', 状态: '已逾期' },
]
const specs = {
  chart: { kind: 'chart', chartType: 'bar', series: { dimension: '区域', measure: { op: 'sum', field: '销售额' } } },
  table: { kind: 'table', columns: [{ key: '区域' }, { key: '产品' }, { key: '销售额' }] },
  dashboard: {
    kind: 'dashboard', filters: ['区域'],
    kpis: [{ label: '总销售额', value: { op: 'sum', field: '销售额' } }, { label: '单数', value: { op: 'count' } }],
    charts: [{ title: '按区域', chartType: 'pie', series: { dimension: '区域', measure: { op: 'sum', field: '销售额' } } }],
    table: { columns: [{ key: '区域' }, { key: '销售额' }] },
  },
  site: {
    kind: 'site', title: '销售门户', sections: [{ type: 'hero', title: '销售业绩', subtitle: '本季概览' }],
    dashboard: { kind: 'dashboard', kpis: [{ label: '额', value: { op: 'sum', field: '销售额' } }], charts: [{ chartType: 'bar', series: { dimension: '区域' } }] },
  },
  slides: { kind: 'slides', slides: [{ layout: 'title', title: '回顾' }, { layout: 'chart', title: 'C', chart: { animation: false, series: [{ type: 'pie', data: [{ name: '华东', value: 4 }] }] } }] },
}

// kind → assertion run IN the sandbox page after render
const assertFor = {
  chart: () => document.querySelectorAll('canvas').length >= 1,
  table: () => document.querySelectorAll('table tr').length >= 2,
  dashboard: () => document.querySelectorAll('.stat').length >= 1 && document.querySelectorAll('canvas').length >= 1 && document.querySelectorAll('table tr').length >= 1,
  site: () => (document.querySelector('.brand')?.textContent || '').includes('销售门户') && (document.querySelectorAll('canvas').length >= 1 || document.querySelectorAll('.stat').length >= 1),
  slides: () => !!document.querySelector('.slides-next') || document.body.textContent.includes('回顾'),
}

const server = spawn('npm', ['run', 'dev:ui'], { stdio: ['ignore', 'pipe', 'pipe'] })
const port = await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('dev:ui 启动超时')), 30000)
  server.stdout.on('data', (b) => { const m = String(b).match(/localhost:(\d+)/); if (m) { clearTimeout(t); res(m[1]) } })
})
const launch = async () => {
  try { return await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] }) }
  catch { return puppeteer.launch({ headless: 'new', executablePath: CHROME, args: ['--no-sandbox'] }) }
}
const browser = await launch()
const page = await browser.newPage()
await page.setViewport({ width: 900, height: 640 })
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
page.on('console', (m) => {
  // dev:ui has no backend, so resource 404s are expected noise — only flag real JS console errors.
  if (m.type() === 'error' && !/Failed to load resource|404|net::ERR/i.test(m.text())) errs.push('console: ' + m.text())
})
await page.goto(`http://localhost:${port}/src/sandbox/index.html`, { waitUntil: 'domcontentloaded' })
await sleep(600)

let failed = 0
for (const [kind, spec] of Object.entries(specs)) {
  await page.evaluate((s, d) => window.postMessage({ type: 'DATAVIZ_RENDER', nonce: 'rt', spec: s, data: d, theme: 'light' }, '*'), spec, rows)
  await sleep(800)
  const okFn = assertFor[kind]
  const pass = await page.evaluate(`(${okFn.toString()})()`)
  console.log(`${pass ? '✅' : '❌'} render ${kind}`)
  if (!pass) failed++
}

await browser.close()
server.kill('SIGTERM')
if (errs.length) { console.log('⚠ page errors:\n  ' + errs.slice(0, 5).join('\n  ')); failed += errs.length }
console.log(failed ? `\n🔴 ${failed} 项渲染未通过` : '\n✅ 所有 spec 都渲染出内容')
process.exit(failed ? 1 : 0)
