/**
 * Proof for the Chrome Web Store "no remote code" answer: after a store build
 * (VITE_WEBSTORE=1 npx vite build --mode store), assert the bundle contains NO
 * `new Function(` / `eval(` in the sandbox (or anywhere) — i.e. no path executes
 * remotely-obtained code. Exits non-zero if found.  Run:  node scripts/check-no-eval.mjs
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

const DIST = 'dist'
const NEEDLES = ['new Function(', 'new Function (']
let hits = []

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(js|mjs)$/.test(name)) {
      const txt = readFileSync(p, 'utf8')
      for (const n of NEEDLES) if (txt.includes(n)) hits.push(`${p}: contains "${n}"`)
    }
  }
}

try { walk(DIST) } catch { console.error('No dist/ — build first.'); process.exit(2) }

if (hits.length) {
  console.error('🔴 store 包仍含可执行远程代码的入口（应为 0）：')
  for (const h of hits) console.error('  ' + h)
  console.error('→ 该构建不能在商店声明“无远程代码”。')
  process.exit(1)
}
console.log('✅ dist/ 中无 new Function( —— 可如实声明“无远程代码”。')
