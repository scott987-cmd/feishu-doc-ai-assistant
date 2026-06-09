/**
 * Chrome Web Store "marquee promo tile" (top hero): 1400x560, 24-bit PNG, NO alpha.
 * Run:  node scripts/promo-marquee.mjs   → docs/store-screenshots/marquee-1400x560.png
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

const W = 1400, H = 560
const FONT = 'Hiragino Sans GB, PingFang SC, Heiti SC, Microsoft YaHei, sans-serif'
const sparkle = (cx, cy, R, w) =>
  `M${cx},${cy - R} C${cx},${cy - w} ${cx + w},${cy} ${cx + R},${cy} ` +
  `C${cx + w},${cy} ${cx},${cy + w} ${cx},${cy + R} ` +
  `C${cx},${cy + w} ${cx - w},${cy} ${cx - R},${cy} ` +
  `C${cx - w},${cy} ${cx},${cy - w} ${cx},${cy - R} Z`

const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#7C5CFC"/><stop offset="1" stop-color="#B96BF0"/>
  </linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <path d="${sparkle(1180, 470, 240, 44)}" fill="#ffffff" opacity="0.07"/>
  <path d="${sparkle(96, 150, 40, 8)}" fill="#ffffff"/>
  <path d="${sparkle(150, 108, 15, 3)}" fill="#ffffff" opacity="0.9"/>
  <text x="80" y="280" font-family="${FONT}" font-size="62" font-weight="700" fill="#ffffff">AI 助手 for 飞书</text>
  <text x="84" y="338" font-family="${FONT}" font-size="30" fill="#EFE9FF">多维表格 · 文档 · 电子表格，一句话交给 AI</text>
  <text x="84" y="392" font-family="${FONT}" font-size="25" fill="#E3D8FF">建表 · 填数 · 看板 · 建站 · PPT · 分析报告 · 文档总结体检</text>
  <text x="84" y="510" font-family="${FONT}" font-size="17" fill="#ffffff" opacity="0.78">第三方开源工具 · 与飞书无官方关联</text>
</svg>`)

const meta = await sharp(join(SRC, '01-chat-welcome.png')).metadata()
const h = 480, w = Math.round(meta.width * (h / meta.height))
const panel = await sharp(join(SRC, '01-chat-welcome.png')).resize(w, h).toBuffer()

await sharp(bg)
  .composite([{ input: panel, left: W - w - 90, top: Math.round((H - h) / 2) }])
  .flatten({ background: '#7C5CFC' })
  .removeAlpha()
  .png({ compressionLevel: 9 })
  .toFile(join(OUT, 'marquee-1400x560.png'))
console.log('done → docs/store-screenshots/marquee-1400x560.png')
