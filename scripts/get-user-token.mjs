/**
 * 本地 OAuth 抓取 user_access_token。
 * 用法: node scripts/get-user-token.mjs
 *
 * 前置: 在飞书开放平台 该应用 →「安全设置」→「重定向 URL」里
 *       添加一条:  http://localhost:53682/callback
 * 读取 feishu-app-config.txt 里的 APP_ID / App_Secret，
 * 授权成功后把 user_access_token 写入 user-token.txt。
 */
import http from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { exec } from 'node:child_process'

const cfg = readFileSync('feishu-app-config.txt', 'utf8')
const clientId = cfg.match(/APP_ID\s*=\s*(\S+)/i)?.[1]
const clientSecret = cfg.match(/App_Secret\s*=\s*(\S+)/i)?.[1]
if (!clientId || !clientSecret) { console.error('✗ 读不到 APP_ID/App_Secret'); process.exit(1) }

const PORT = 53682
const redirectUri = `http://localhost:${PORT}/callback`
const scope = 'bitable:app offline_access'
const state = 'eapcheck'
const authUrl =
  `https://accounts.feishu.cn/open-apis/authen/v1/authorize?client_id=${clientId}` +
  `&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}` +
  `&state=${state}&response_type=code`

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.url.startsWith('/callback')) { res.writeHead(404); res.end(); return }
  const code = new URL(req.url, redirectUri).searchParams.get('code')
  if (!code) { res.writeHead(400); res.end('no code'); return }

  const tj = await (await fetch('https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId, client_secret: clientSecret,
      code, redirect_uri: redirectUri,
    }),
  })).json()

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  if (tj.access_token) {
    writeFileSync('user-token.txt', tj.access_token + '\n')
    res.end('<h2>✅ 授权成功，token 已保存到 user-token.txt，可关闭本页回终端</h2>')
    console.log('✅ user_access_token 已写入 user-token.txt')
    setTimeout(() => process.exit(0), 300)
  } else {
    res.end('<pre>换取失败: ' + JSON.stringify(tj, null, 2) + '</pre>')
    console.error('❌ 换取失败:', JSON.stringify(tj))
    setTimeout(() => process.exit(1), 300)
  }
})

server.listen(PORT, () => {
  console.log('正在打开浏览器授权…如未自动打开，手动访问:\n' + authUrl + '\n')
  exec(`open "${authUrl}"`)
})
