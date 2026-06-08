/**
 * Headless UI smoke test: boots dev:ui (chrome-mocked) and drives it with
 * Puppeteer to catch render crashes / console errors that unit tests can't.
 *
 *   node scripts/ui-smoke.mjs
 *
 * Exits non-zero on any page error, console error, or failed assertion.
 */
import { spawn } from 'node:child_process'
import puppeteer from 'puppeteer'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const checks = []
const ok = (name, cond) => { checks.push({ name, pass: !!cond }); console.log(`${cond ? '✅' : '❌'} ${name}`) }

// ── boot dev:ui ──────────────────────────────────────────────────────────────
const server = spawn('npm', ['run', 'dev:ui'], { stdio: ['ignore', 'pipe', 'pipe'] })
const port = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('dev:ui 启动超时')), 30000)
  server.stdout.on('data', (b) => {
    const m = String(b).match(/localhost:(\d+)/)
    if (m) { clearTimeout(t); resolve(m[1]) }
  })
})
console.log(`dev:ui → http://localhost:${port}/dev.html`)

async function launch() {
  try { return await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] }) }
  catch { return puppeteer.launch({ headless: 'new', executablePath: CHROME, args: ['--no-sandbox'] }) }
}

let browser
try {
  browser = await launch()
  const page = await browser.newPage()
  const errors = []
  // dev:ui has no backend, so network calls to the Feishu API fail (CORS/404) —
  // that's expected noise, not a bug. Only flag real JS exceptions / React errors.
  const isNoise = (t) => /Failed to load resource|CORS policy|ERR_FAILED|net::|tenant_access_token|favicon/.test(t)
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !isNoise(m.text())) errors.push(`console.error: ${m.text()}`) })

  await page.goto(`http://localhost:${port}/dev.html`, { waitUntil: 'networkidle0', timeout: 20000 })
  await new Promise((r) => setTimeout(r, 1200))

  ok('应用渲染（品牌名）', (await page.$eval('.brand-name', (e) => e.textContent).catch(() => '')) === '飞书文档AI助手')
  ok('底部 Tab 存在', (await page.$$('.app-tab')).length === 2)

  // 打开设置
  await page.click('.btn-icon[title="Settings"]')
  await new Promise((r) => setTimeout(r, 400))
  ok('设置面板打开', !!(await page.$('.settings')))
  ok('设置含主题色板', (await page.$$('.accent-swatch')).length > 0)

  // 切主题色
  const swatches = await page.$$('.accent-swatch')
  if (swatches[1]) await swatches[1].click()
  await new Promise((r) => setTimeout(r, 200))
  const primary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-primary'))
  ok('切换主题色生效（--color-primary 非空）', primary.trim().length > 0)

  // 关设置 → 切到场景 Tab
  await page.click('.settings-header .btn-icon')
  await new Promise((r) => setTimeout(r, 300))
  const tabs = await page.$$('.app-tab')
  await tabs[1].click()
  await new Promise((r) => setTimeout(r, 400))
  ok('场景面板渲染', !!(await page.$('.scenario-panel')))
  // 场景 hub 按 job 分组（上下文感知）
  ok('场景 hub 分组标题存在', (await page.$$('.sc-hub-section')).length > 0)
  ok('场景 hub 当前页面状态条', !!(await page.$('.sc-hub-status')))

  // 进入「AI 幻灯片」面板（演示 / PPT 组）
  const enteredSlides = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.sc-hub-card--entry')].find((c) => c.textContent.includes('AI 幻灯片'))
    if (card) { card.click(); return true }
    return false
  })
  await new Promise((r) => setTimeout(r, 400))
  ok('AI 幻灯片入口存在', enteredSlides)
  ok('AI 幻灯片面板渲染', !!(await page.$('.sl-title')))

  ok('无 page/console 报错', errors.length === 0)
  if (errors.length) errors.forEach((e) => console.log('   ·', e))

  await browser.close()
} finally {
  if (browser) await browser.close().catch(() => {})
  server.kill('SIGTERM')
}

const failed = checks.filter((c) => !c.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} 通过`)
process.exit(failed.length ? 1 : 0)
