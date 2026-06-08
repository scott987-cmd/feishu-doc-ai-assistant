/**
 * 一键打包：构建 → 打 zip →（有签名私钥时）打 .crx。
 * 用法：npm run pack
 * 产物：dist/（直接加载已解压）、feishu-doc-ai-assistant.zip（分发/备份）、可选 .crx。
 * 产物均已 .gitignore，不会进仓库。
 */
import { execSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'

const sh = (cmd) => execSync(cmd, { stdio: 'inherit' })
const ZIP = 'feishu-doc-ai-assistant.zip'
const CRX = 'feishu-doc-ai-assistant.crx'

console.log('▶ 1/3 构建（npm run build）…')
sh('npm run build')

console.log('▶ 2/3 打包 zip…')
try {
  rmSync(ZIP, { force: true })
  sh(`cd dist && zip -qr ../${ZIP} . && cd ..`)
  console.log(`  ✓ ${ZIP}`)
} catch {
  console.warn('  ⚠ 未找到 zip 命令（Windows 可手动压缩 dist/ 文件夹）。')
}

console.log('▶ 3/3 可选 .crx（需签名私钥 + 本机 Chrome）…')
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (existsSync('extension-key.pem') && existsSync(chrome)) {
  try {
    sh(`"${chrome}" --pack-extension="${process.cwd()}/dist" --pack-extension-key="${process.cwd()}/extension-key.pem" --no-message-box`)
    if (existsSync('dist.crx')) { rmSync(CRX, { force: true }); sh(`mv -f dist.crx ${CRX}`); console.log(`  ✓ ${CRX}`) }
  } catch { console.warn('  ⚠ 打 .crx 失败（跳过，不影响 dist/ 与 zip 使用）。') }
} else {
  console.log('  · 跳过（无 extension-key.pem 或未找到 Chrome）——个人自用直接加载 dist/ 即可。')
}

console.log('\n✅ 打包完成：')
console.log('  · dist/                        → chrome://extensions → 开发者模式 →「加载已解压」选它，立即可用')
console.log(`  · ${ZIP}  → 备份 / 发给别人（对方解压后同样「加载已解压」）`)
