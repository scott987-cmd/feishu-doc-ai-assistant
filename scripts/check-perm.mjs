/**
 * 自检飞书应用的 bitable 权限是否已生效。
 * 用法: node scripts/check-perm.mjs
 * 读取项目根目录的 feishu-app-config.txt (APP_ID / App_Secret)。
 */
import { readFileSync } from 'node:fs'

const cfg = readFileSync('feishu-app-config.txt', 'utf8')
const appId = cfg.match(/APP_ID\s*=\s*(\S+)/i)?.[1]
const appSecret = cfg.match(/App_Secret\s*=\s*(\S+)/i)?.[1]
if (!appId || !appSecret) {
  console.error('✗ 读不到 APP_ID / App_Secret，请检查 feishu-app-config.txt')
  process.exit(1)
}

const tj = await (await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
})).json()
if (tj.code !== 0) { console.error('✗ 换 token 失败:', tj.msg); process.exit(1) }
const token = tj.tenant_access_token
console.log('✓ tenant_access_token 获取成功')

const cb = await (await fetch('https://open.feishu.cn/open-apis/bitable/v1/apps', {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: `perm_check_${Date.now()}` }),
})).json()
if (cb.code !== 0) { console.error('✗ 建 Base 失败(连云空间权限都没有):', cb.msg); process.exit(1) }
const appToken = cb.data.app.app_token

const ct = await (await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ table: { name: 'perm_check', fields: [{ field_name: '标题', type: 1 }] } }),
})).json()

if (ct.code === 0) {
  console.log('✅ bitable:app 权限已生效 —— 可以跑 FEISHU_LIVE=1 npx vitest run src/shared/feishu/live.test.ts')
} else {
  console.log(`❌ bitable:app 仍未生效 (code=${ct.code})`)
  console.log('   →', ct.msg)
}
console.log(`(测试用 Base ${appToken} 已建在云空间，可手动删除)`)
