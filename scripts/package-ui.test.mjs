import { describe, it, expect } from 'vitest'
import { envFromConfig, validateConfig } from './package-ui.mjs'

// 把 .env 文本解析成 {KEY: value}（忽略注释/空行），方便断言"到底写了哪些变量"。
const parse = (txt) => Object.fromEntries(
  txt.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => {
    const i = l.indexOf('=')
    return [l.slice(0, i), l.slice(i + 1)]
  }),
)

describe('envFromConfig', () => {
  it('换行注入被消除——含 \\n 的值不会注入第二个 env 变量', () => {
    const env = parse(envFromConfig({ mode: 'enterprise', proxyUrl: 'https://p/o', appIdFromProxy: true, allowedHosts: 'api.x.com\nVITE_NO_REMOTE_CODE=' }))
    expect(env.VITE_OPENAI_ALLOWED_HOSTS).toBe('api.x.com VITE_NO_REMOTE_CODE=') // 合成到一行，未另起变量
    expect('VITE_NO_REMOTE_CODE' in env).toBe(false) // 没有被注入出来
    // 整份文本里 VITE_NO_REMOTE_CODE 只可能作为某个值的一部分，绝不作为行首 KEY 出现
    expect(envFromConfig({ mode: 'enterprise', proxyUrl: 'https://p/o', appIdFromProxy: true, oauthScope: 'a\nVITE_FEISHU_APP_SECRET=leak' }))
      .not.toMatch(/^VITE_FEISHU_APP_SECRET=leak/m)
  })

  it('商店模式：写 VITE_WEBSTORE，名称走 VITE_STORE_NAME，绝不内置 secret', () => {
    const env = parse(envFromConfig({ mode: 'store', name: 'ACME', desc: '内部工具', appSecret: 'should-not-appear' }))
    expect(env.VITE_WEBSTORE).toBe('1')
    expect(env.VITE_STORE_NAME).toBe('ACME')
    expect(env.VITE_STORE_DESC).toBe('内部工具')
    expect('VITE_FEISHU_APP_SECRET' in env).toBe(false) // 商店版不内置任何凭据
  })

  it('私有化无代理：勾选的企业能力开关如实写入（不再被静默丢弃）', () => {
    const env = parse(envFromConfig({ mode: 'private', appId: 'cli_x', appSecret: 's', baseDomain: 'corp.com', policy: true, skills: true, artifacts: true }))
    expect(env.VITE_ENTERPRISE_POLICY).toBe('1')
    expect(env.VITE_SKILLS_ENABLED).toBe('1')
    expect(env.VITE_ARTIFACT_SYNC).toBe('1')
    expect(env.VITE_FEISHU_BASE_DOMAIN).toBe('corp.com')
  })

  it('个人模式：写入 App ID + Secret', () => {
    const env = parse(envFromConfig({ mode: 'personal', appId: 'cli_abc', appSecret: 'secret123' }))
    expect(env.VITE_FEISHU_APP_ID).toBe('cli_abc')
    expect(env.VITE_FEISHU_APP_SECRET).toBe('secret123')
  })

  it('mode 注入被消除：含换行的 mode 不会从注释行伪造出额外 VITE_* 变量', () => {
    const out = envFromConfig({ mode: 'store\nVITE_OAUTH_PROXY_URL=https://evil.example.com\nVITE_FEISHU_APP_SECRET=pwned' })
    const env = parse(out)
    expect('VITE_OAUTH_PROXY_URL' in env).toBe(false) // 没被注入
    expect('VITE_FEISHU_APP_SECRET' in env).toBe(false) // 没被注入（且非法 mode 回落 enterprise，不走 store 分支）
    expect(out).not.toMatch(/^VITE_OAUTH_PROXY_URL=https:\/\/evil/m)
    expect(out).not.toMatch(/^VITE_FEISHU_APP_SECRET=pwned/m)
  })
})

describe('validateConfig', () => {
  it('商店版无需内置 App ID → 通过', () => {
    expect(validateConfig({ mode: 'store' })).toBeNull()
  })
  it('个人版缺 App ID → 报错', () => {
    expect(validateConfig({ mode: 'personal' })).toMatch(/App ID/)
  })
  it('企业版 App ID 从代理下发（含代理地址）→ 通过', () => {
    expect(validateConfig({ mode: 'enterprise', appIdFromProxy: true, proxyUrl: 'https://p/o' })).toBeNull()
  })
  it('私有化取消"从代理下发"又不填 App ID（即使有代理）→ 报错（修死包）', () => {
    expect(validateConfig({ mode: 'private', appIdFromProxy: false, proxyUrl: 'https://p/o', baseDomain: 'c.com' })).toMatch(/App ID/)
  })
  it('私有化填了 App ID → 通过', () => {
    expect(validateConfig({ mode: 'private', appId: 'cli_x', baseDomain: 'c.com' })).toBeNull()
  })
  it('未知/被注入的 mode → 报错（不进入打包）', () => {
    expect(validateConfig({ mode: 'store\nVITE_FEISHU_APP_SECRET=x', appId: 'cli_x' })).toMatch(/未知打包模式/)
  })
})
