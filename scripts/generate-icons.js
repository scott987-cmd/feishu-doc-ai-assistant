#!/usr/bin/env node
/**
 * Generates PNG icons for the Chrome extension using sharp + SVG.
 * Run once: node scripts/generate-icons.js
 */
import { createRequire } from 'module'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '../public/icons')
mkdirSync(outDir, { recursive: true })

let sharp
try {
  const require = createRequire(import.meta.url)
  sharp = require('sharp')
} catch {
  console.warn('[icons] sharp not available — writing minimal placeholder PNGs')
  writePlaceholders()
  process.exit(0)
}

const SIZES = [16, 32, 48, 128]

// Original mark: a 4-point "AI sparkle" on a violet→indigo gradient. Deliberately NO brand
// letter and NOT Feishu blue — avoids implying affiliation with Feishu/ByteDance (and the
// Facebook-style blue "F" the old icon resembled). Pure geometry, our own artwork.
const sparkle = (cx, cy, R, w) =>
  `M${cx},${cy - R} C${cx},${cy - w} ${cx + w},${cy} ${cx + R},${cy} ` +
  `C${cx + w},${cy} ${cx},${cy + w} ${cx},${cy + R} ` +
  `C${cx},${cy + w} ${cx - w},${cy} ${cx - R},${cy} ` +
  `C${cx - w},${cy} ${cx},${cy - w} ${cx},${cy - R} Z`

for (const size of SIZES) {
  const r = Math.round(size / 5)
  const R = size * 0.30, w = R * 0.18
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#7C5CFC"/><stop offset="1" stop-color="#B96BF0"/>
  </linearGradient></defs>
  <rect width="${size}" height="${size}" rx="${r}" fill="url(#g)"/>
  <path d="${sparkle(size * 0.44, size * 0.54, R, w)}" fill="#ffffff"/>
  <path d="${sparkle(size * 0.76, size * 0.27, size * 0.12, size * 0.12 * 0.18)}" fill="#ffffff" opacity="0.9"/>
</svg>`

  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(join(outDir, `icon${size}.png`))
  console.log(`[icons] icon${size}.png`)
}

/** Fallback: minimal 1×1 blue PNG for each size (Chrome won't error, just shows tiny icon) */
function writePlaceholders() {
  // Minimal valid PNG: 1×1 blue pixel
  const minPng = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
    '2e0000000c4944415408d76360f8cfc00000000200016af63d510000000049454e44ae426082',
    'hex'
  )
  for (const size of [16, 32, 48, 128]) {
    writeFileSync(join(outDir, `icon${size}.png`), minPng)
    console.log(`[icons] icon${size}.png (placeholder)`)
  }
}
