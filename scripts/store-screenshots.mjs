/**
 * Compose Chrome Web Store screenshots from the UI captures in docs/screenshots/.
 * Output: docs/store-screenshots/store{1..5}.png — exactly 1280x800, 24-bit, NO alpha
 * (store requirement). Run:  node scripts/store-screenshots.mjs   (needs sharp)
 */
import { createRequire } from 'module'
import { mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const sharp = require('sharp')
const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = join(__dirname, '../docs/screenshots')
const OUT = join(__dirname, '../docs/store-screenshots')
mkdirSync(OUT, { recursive: true })

const W = 1280, H = 800
const FONT = 'Hiragino Sans GB, PingFang SC, Heiti SC, Microsoft YaHei, sans-serif'
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const shots = [
  { src: '01-chat-welcome.png', title: '一句话操作飞书', sub: '对话即可建表 · 填数 · 写公式 · 跨表查找 · 批量改' },
  { src: '02-hub-base.png',     title: '场景能力中心',   sub: '按当前页面智能分组，一键直达可用能力' },
  { src: '04-dataviz-panel.png',title: '把数据做成看板', sub: 'AI 看板 / 小程序 / 建站，页面悬浮窗即开即用' },
  { src: '21-slide-chart.png',  title: '一键生成 PPT',   sub: '文档 / 表格转多页演示，可翻页、配色、导出 PDF' },
  { src: '06-smartfill-panel.png', title: '智能填充 & 分析报告', sub: 'AI 补全空缺值、生成带真实数字的分析文档' },
]

function bgAndCaption(title, sub) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#EFEAFF"/><stop offset="1" stop-color="#FDFBFF"/>
      </linearGradient></defs>
      <rect width="${W}" height="${H}" fill="url(#g)"/>
      <rect x="0" y="0" width="${W}" height="8" fill="#7C5CFC"/>
      <text x="64" y="78" font-family="${FONT}" font-size="46" font-weight="700" fill="#2B2350">${esc(title)}</text>
      <text x="66" y="118" font-family="${FONT}" font-size="24" fill="#6B5E8C">${esc(sub)}</text>
    </svg>`
  )
}

const CAP_BOTTOM = 150 // caption band height at top

for (let i = 0; i < shots.length; i++) {
  const s = shots[i]
  const meta = await sharp(join(SRC, s.src)).metadata()
  // Fit the capture into the area below the caption band.
  const maxW = W - 160, maxH = H - CAP_BOTTOM - 40
  const scale = Math.min(maxW / meta.width, maxH / meta.height)
  const w = Math.round(meta.width * scale), h = Math.round(meta.height * scale)
  const img = await sharp(join(SRC, s.src)).resize(w, h).toBuffer()
  const left = Math.round((W - w) / 2)
  const top = CAP_BOTTOM + Math.round((H - CAP_BOTTOM - h) / 2)

  await sharp(bgAndCaption(s.title, s.sub))
    .composite([{ input: img, left, top }])
    .flatten({ background: '#FDFBFF' }) // composite onto opaque bg
    .removeAlpha()                       // force 3-channel → 24-bit, no alpha (store requirement)
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, `store${i + 1}.png`))
  console.log(`store${i + 1}.png  ←  ${s.src}  (${w}x${h})`)
}
console.log('done →', OUT)
