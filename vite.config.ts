// build rev 9f4b7e2a
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import webExtension from 'vite-plugin-web-extension'
import { resolve } from 'path'

const originOf = (u: string): string => {
  try { return new URL(u).origin } catch { return '' }
}

export default defineConfig(({ command, mode }) => {
  // Build-time deployment config. Everything derives from ONE Feishu base domain:
  // public SaaS = feishu.cn; a private (on-prem) deploy only changes this suffix, e.g.
  // test.com → open.test.com / accounts.test.com / <tenant>.test.com (paths identical).
  const env = loadEnv(mode, process.cwd(), '')
  const baseDomain = (env.VITE_FEISHU_BASE_DOMAIN || 'feishu.cn')
    .trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^\.+|\.+$/g, '')
  const feishuMatch = `https://*.${baseDomain}/*`

  // connect-src: the assistant only ever reaches two endpoint groups — Feishu (any
  // subdomain of the base domain) and the LLM. When the LLM hosts are pinned
  // (VITE_OPENAI_ALLOWED_HOSTS) connect-src lists exactly them → pure-intranet lockdown;
  // otherwise `https:` keeps a personal build's custom endpoint working.
  const llmHosts = (env.VITE_OPENAI_ALLOWED_HOSTS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  const proxyOrigin = originOf((env.VITE_OAUTH_PROXY_URL || '').trim())
  const registryOrigin = originOf((env.VITE_DEFAULT_REGISTRY_URL || '').trim())

  const connect = ["'self'", `https://*.${baseDomain}`]
  if (proxyOrigin) connect.push(proxyOrigin)
  if (registryOrigin) connect.push(registryOrigin)
  connect.push(llmHosts.length ? llmHosts.map((h) => `https://${h}`).join(' ') : 'https:')
  // Dev needs the Vite HMR websocket; only lock down for production builds.
  const connectSrc = command === 'serve'
    ? "'self' http://localhost:* ws://localhost:* https:"
    : connect.join(' ')
  const csp =
    `default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; ` +
    `frame-ancestors 'none'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; ` +
    `font-src 'self' data:; connect-src ${connectSrc}`

  // Sandbox page CSP (data-viz). Runs LLM-generated render code + bundled ECharts in a
  // null/opaque origin with NO chrome.* and — crucially — `connect-src 'none'`, so the
  // generated code can render but CANNOT exfiltrate the user's table data over the network.
  // `unsafe-eval` is required for `new Function(code)` + ECharts; isolation comes from the
  // null origin, not from script-src.
  // allow-modals: the CSP `sandbox` directive is the OUTER limit — it intersects with the iframe's
  // own sandbox attr, so without allow-modals here `window.print()` (导出 PDF) is silently ignored
  // even though the <iframe sandbox> grants it. connect-src 'none' still walls the LLM code off.
  const sandboxCsp =
    `sandbox allow-scripts allow-modals; script-src 'self' 'unsafe-inline' 'unsafe-eval'; ` +
    `object-src 'none'; child-src 'none'; frame-src 'none'; connect-src 'none'; ` +
    `img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; base-uri 'none'`

  return {
    resolve: {
      alias: { '@': resolve(__dirname, 'src') },
    },
    plugins: [
      react(),
      webExtension({
        manifest: 'manifest.json',
        watchFilePaths: ['manifest.json', '.env', '.env.local'],
        browser: 'chrome',
        // Template the deployment-specific bits so one codebase serves
        // personal / enterprise-SaaS / private-on-prem from build-time env alone.
        transformManifest(manifest: Record<string, unknown>) {
          // Chrome Web Store rejects packages that contain a `key` (it assigns the ID itself).
          // For a store build set VITE_WEBSTORE=1 to strip it; self-distributed .crx keeps the
          // baked `key` so the extension ID (and OAuth redirect URL) stays stable.
          if (env.VITE_WEBSTORE === '1' || env.VITE_WEBSTORE === 'true') delete manifest.key
          manifest.host_permissions = [feishuMatch]
          const cs = manifest.content_scripts as Array<{ matches: string[] }> | undefined
          if (cs?.[0]) cs[0].matches = [feishuMatch]
          // Merge BOTH keys — must not drop the sandbox CSP by overwriting the object.
          manifest.content_security_policy = { extension_pages: csp, sandbox: sandboxCsp }
          // The sandbox iframe is framed from the Feishu page → template its matches to the
          // deployment's base domain (mirrors host_permissions/content_scripts above).
          const war = manifest.web_accessible_resources as Array<{ matches: string[] }> | undefined
          if (war?.[0]) war[0].matches = [feishuMatch]
          return manifest
        },
      }),
    ],
    build: {
      sourcemap: command === 'serve', // sourcemaps in dev, stripped in prod
      minify: command === 'build',
      target: 'esnext',
    },
  }
})
