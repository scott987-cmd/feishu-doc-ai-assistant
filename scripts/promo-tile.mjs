/**
 * Chrome Web Store "small promo tile": 440x280, 24-bit PNG, NO alpha.
 * Run:  node scripts/promo-tile.mjs   (needs sharp).  → docs/store-screenshots/promo-440x280.png
 */
import { createRequire } from 'module'
import { mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const sharp = require('sharp')
const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '../docs/store-screenshots')
mkdirSync(OUT, { recursive: true })

const W = 440, H = 280
const FONT = 'Hiragino Sans GB, PingFang SC, Heiti SC, Microsoft YaHei, sans-serif'
const sparkle = (cx, cy, R, w) =>
  `M${cx},${cy - R} C${cx},${cy - w} ${cx + w},${cy} ${cx + R},${cy} ` +
  `C${cx + w},${cy} ${cx},${cy + w} ${cx},${cy + R} ` +
  `C${cx},${cy + w} ${cx - w},${cy} ${cx - R},${cy} ` +
  `C${cx - w},${cy} ${cx},${cy - w} ${cx},${cy - R} Z`

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#7C5CFC"/><stop offset="1" stop-color="#B96BF0"/>
  </linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <path d="${sparkle(388, 232, 130, 24)}" fill="#ffffff" opacity="0.08"/>
  <path d="${sparkle(70, 84, 34, 7)}" fill="#ffffff"/>
  <path d="${sparkle(112, 52, 13, 2.5)}" fill="#ffffff" opacity="0.9"/>
  <text x="40" y="160" font-family="${FONT}" font-size="34" font-weight="700" fill="#ffffff">AI 助手 for 飞书</text>
  <text x="42" y="194" font-family="${FONT}" font-size="17" fill="#EFE9FF">多维表格 · 文档 · 电子表格</text>
  <text x="42" y="224" font-family="${FONT}" font-size="16" fill="#E3D8FF">一句话搞定建表 · 看板 · PPT · 分析报告</text>
  <text x="42" y="258" font-family="${FONT}" font-size="12" fill="#ffffff" opacity="0.78">第三方开源工具 · 与飞书无官方关联</text>
</svg>`

await sharp(Buffer.from(svg))
  .flatten({ background: '#7C5CFC' })
  .removeAlpha()
  .png({ compressionLevel: 9 })
  .toFile(join(OUT, 'promo-440x280.png'))
console.log('done → docs/store-screenshots/promo-440x280.png')
