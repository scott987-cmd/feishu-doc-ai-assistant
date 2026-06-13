/**
 * Capture documentation screenshots of the side panel (chrome-mocked dev:ui) and the slide
 * renderer (the sandbox page, driven via postMessage). Output → docs/screenshots/*.png
 *
 *   node scripts/capture-screenshots.mjs
 */
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import puppeteer from 'puppeteer'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT = 'docs/screenshots'
await mkdir(OUT, { recursive: true })

const server = spawn('npm', ['run', 'dev:ui'], { stdio: ['ignore', 'pipe', 'pipe'] })
const port = await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('dev:ui 启动超时')), 30000)
  server.stdout.on('data', (b) => { const m = String(b).match(/localhost:(\d+)/); if (m) { clearTimeout(t); res(m[1]) } })
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const launch = async () => {
  try { return await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] }) }
  catch { return puppeteer.launch({ headless: 'new', executablePath: CHROME, args: ['--no-sandbox'] }) }
}

// Demo page contexts + seed data.
const BASE = { url: 'https://base.feishu.cn/base/Demo?table=tbl&view=v', title: '销售数据 · 多维表格', selectedText: '', feishu: { isBase: true, kind: 'base', appToken: 'Demo', tableId: 'tbl' } }
const DOC = { url: 'https://x.feishu.cn/docx/Doc', title: '产品需求文档 PRD', selectedText: '', feishu: { isBase: false, kind: 'doc', documentId: 'Doc' } }
const SAVED_DECK = { id: 'demo-deck', name: '2024 销售业绩回顾', srcKey: 'base:Demo', createdAt: 1, slides: [{ layout: 'title', title: 'x' }] }
const SAVED_VIZ = { id: 'demo-viz', name: '区域营收看板', source: { kind: 'base', appToken: 'Demo', tableId: 'tbl' }, code: 'ui.chart(container,{})', createdAt: 1, kind: 'viz' }

const browser = await launch()
const page = await browser.newPage()
await page.setViewport({ width: 400, height: 700, deviceScaleFactor: 2 })
const base = `http://localhost:${port}/scripts/dev.html`
const errs = []
page.on('pageerror', (e) => errs.push(e.message))

// Seed settings (so the app is "configured") + a page scenario + sample saved items, then reload.
async function setup(scenario, { dark = false } = {}) {
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async (sc, deck, viz, dark) => {
    const { encryptField } = await import('/src/shared/crypto.ts')
    // encryptField writes the _device_seed into the mock store; use chrome.storage.local.set so it
    // MERGES (keeping that seed) — overwriting localStorage directly would drop the seed and the
    // app would then decrypt with a fresh key and read empty settings (→ "configure" banner).
    const settings_v2 = {
      openaiBaseUrl: 'https://api.deepseek.com', openaiModel: 'deepseek-v4-pro',
      openaiApiKey: await encryptField('sk-demo'), feishuAccessToken: await encryptField('u-demo'),
      feishuOwnerOpenId: 'ou_demo', learnFromHistory: true, voiceInput: true, autoConfirm: false,
    }
    await new Promise((r) => chrome.storage.local.set({ settings_v2, slides_decks_v1: [deck], dataviz_v1: [viz] }, r))
    localStorage.setItem('__mock_scenario__', JSON.stringify(sc))
    localStorage.setItem('fa-theme', dark ? 'dark' : 'light')
  }, scenario, SAVED_DECK, SAVED_VIZ, dark)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await sleep(900)
}

// Click a bottom tab ('对话' | '场景').
const tab = async (label) => {
  await page.evaluate((l) => { const t = [...document.querySelectorAll('.app-tab')].find((x) => x.textContent.includes(l)); t && t.click() }, label)
  await sleep(450)
}
// Click a hub feature card by its title.
const card = async (title) => {
  await page.evaluate((t) => { const c = [...document.querySelectorAll('.sc-hub-card--entry')].find((x) => x.textContent.includes(t)); c && c.click() }, title)
  await sleep(450)
}
const shot = async (name) => { await page.screenshot({ path: `${OUT}/${name}.png` }); console.log('📸', name) }
// Return from a feature sub-view to the hub (the 场景 tab stays mounted, so re-clicking the tab
// won't reset its internal view — click the panel's own ← 返回).
const back = async () => { await page.evaluate(() => document.querySelector('.sc-back, .sc-back-btn')?.click()); await sleep(400) }

// ── Side panel ──────────────────────────────────────────────────────────────
await setup(BASE)
await tab('对话'); await shot('01-chat-welcome')
await tab('场景'); await shot('02-hub-base')
await card('AI 幻灯片'); await shot('03-slides-panel'); await back()
await card('AI 小程序'); await shot('04-dataviz-panel'); await back()
await card('AI 建站'); await shot('05-aisite-panel'); await back()
await card('智能填充'); await shot('06-smartfill-panel'); await back()
await card('场景模版库'); await shot('07-gallery'); await back()

await setup(DOC)
await tab('场景'); await shot('08-hub-doc')
await card('文档总结'); await shot('09-docsummary-panel'); await back()

await setup(BASE)
await page.click('.btn-icon[title="Settings"]'); await sleep(500); await shot('10-settings')

// ── Slide renderer (load the sandbox page directly; it accepts a same-window postMessage) ──
const SLIDES = [
  { layout: 'title', title: '2024 销售业绩回顾', subtitle: 'AI 一键生成 · 数据来自飞书多维表格' },
  { layout: 'bullets', title: '核心要点', bullets: ['全年 GMV 同比增长 38%', '华东区贡献 42% 营收', '新客占比提升至 27%', '复购率达到 61%'] },
  { layout: 'chart', title: '各区域营收占比', chart: { animation: false, tooltip: {}, legend: { bottom: 0 }, series: [{ type: 'pie', radius: ['38%', '66%'], center: ['50%', '46%'], data: [{ name: '华东', value: 42 }, { name: '华南', value: 25 }, { name: '华北', value: 18 }, { name: '西南', value: 15 }] }] } },
  { layout: 'stats', title: '关键指标', stats: [{ num: '¥1.2亿', label: '全年 GMV' }, { num: '+38%', label: '同比增长' }, { num: '61%', label: '复购率' }] },
]
const sand = await browser.newPage()
await sand.setViewport({ width: 900, height: 600, deviceScaleFactor: 2 })
const render = async () => sand.evaluate((slides) => window.postMessage({ type: 'DATAVIZ_RENDER', nonce: 'shot', code: 'ui.slides(container, data)', data: slides, theme: document.documentElement.dataset.theme }, '*'), SLIDES)
const sandShot = async (name) => { await sand.screenshot({ path: `${OUT}/${name}.png` }); console.log('📸', name) }

await sand.goto(`http://localhost:${port}/src/sandbox/index.html`, { waitUntil: 'domcontentloaded' })
await sleep(600); await render(); await sleep(700)
await sandShot('20-slide-title')
await sand.click('.slides-next'); await sleep(300); await sand.click('.slides-next'); await sleep(900) // → chart slide
await sandShot('21-slide-chart')
await sand.click('.slides-theme'); await sleep(700) // dark
await sandShot('22-slide-dark')

console.log(errs.length ? `\n⚠ page errors: ${errs.slice(0, 3).join(' | ')}` : '\n✅ no page errors')
await browser.close()
server.kill('SIGTERM')
