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

for (const size of SIZES) {
  const r = Math.round(size / 5)
  const fontSize = Math.round(size * 0.52)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="#3366FF"/>
  <text x="${size / 2}" y="${size * 0.68}" text-anchor="middle"
    font-family="Arial,Helvetica,sans-serif" font-weight="bold"
    font-size="${fontSize}" fill="white">F</text>
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
