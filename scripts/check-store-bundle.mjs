/**
 * Store-bundle safety gate (run in CI after a store build).
 *
 *   VITE_WEBSTORE=1 npx vite build --mode store
 *   node scripts/check-store-bundle.mjs
 *
 * Asserts the public Chrome Web Store bundle in dist/ carries:
 *   1) NO enterprise server endpoints (the proxy-only features must dead-code-eliminate
 *      when there is no oauthProxyUrl — see HAS_* = flag && oauthProxyUrl in config.ts);
 *   2) NO baked secret value (any secret-looking env passed to this process must not
 *      appear verbatim in the bundle — store builds are BYO and ship zero credentials).
 *
 * Exits non-zero on any hit. This turns the manual "store 构建复核端点串为 0" step
 * (CLAUDE.md) into an enforced gate. Generalizes scripts/check-no-eval.mjs.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'

// Enterprise-only endpoint/grant markers. These are only reachable behind
// `HAS_* && oauthProxyUrl`; a store build (no proxy) must not contain them.
const FORBIDDEN_ENDPOINTS = [
  '/skills/list',
  '/skills/promote',
  '/artifacts/list',
  '/artifacts/put',
  '/artifacts/get',
  "grant_type:'app_config'",
  'grant_type:"app_config"',
  "grant_type:'llm_config'",
  'grant_type:"llm_config"',
  "grant_type:'policy'",
  'grant_type:"policy"',
]

// Secret-looking env values that must never be baked into a public bundle.
const SECRET_ENV_KEYS = [
  'VITE_FEISHU_APP_SECRET',
  'VITE_FEISHU_APP_SECRET_ENC',
  'VITE_OAUTH_PROXY_URL',
  'VITE_MANAGED_LLM_KEY',
]
const secretValues = SECRET_ENV_KEYS
  .map((k) => (process.env[k] || '').trim())
  .filter((v) => v.length >= 8) // ignore empty / trivial

const hits = []

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { walk(p); continue }
    if (!/\.(js|mjs|html)$/.test(name)) continue
    const txt = readFileSync(p, 'utf8')
    for (const needle of FORBIDDEN_ENDPOINTS) {
      if (txt.includes(needle)) hits.push(`${p}: enterprise endpoint leaked → "${needle}"`)
    }
    for (const secret of secretValues) {
      if (txt.includes(secret)) hits.push(`${p}: baked secret value leaked (a SECRET_ENV value appears in the bundle)`)
    }
  }
}

try {
  walk(DIST)
} catch {
  console.error('✗ No dist/ — run a store build first: VITE_WEBSTORE=1 npx vite build --mode store')
  process.exit(2)
}

if (hits.length) {
  console.error('✗ store bundle check FAILED:')
  for (const h of hits) console.error('  - ' + h)
  console.error('\nA store build must dead-code-eliminate all proxy-gated enterprise features and bake no secret.')
  process.exit(1)
}
console.log('✓ store bundle clean: no enterprise endpoints, no baked secrets')
