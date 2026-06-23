> 🌐 [English](CONTRIBUTING.en.md) | **中文**

# 贡献指南 · Contributing

感谢你考虑为 **飞书文档AI助手** 做贡献！本项目是一个 Chrome **MV3** 扩展：**无后端**、全部以**用户本人飞书身份**操作。我们欢迎 Issue、PR、文档与翻译改进。

> 本项目以 **[Elastic License 2.0](LICENSE)** 发布:可免费使用 / 修改 / 自部署(含企业内部商用),但**不得作为托管 / SaaS 服务提供给第三方**。提交贡献即表示你同意你的贡献在同一许可证下发布。

---

## 目录

- [行为准则](#行为准则)
- [我可以贡献什么](#我可以贡献什么)
- [上手开发(必读)](#上手开发必读)
- [不可破坏的安全边界(改前必读)](#不可破坏的安全边界改前必读)
- [提交 Pull Request](#提交-pull-request)
- [提交规范](#提交规范)
- [报告安全漏洞](#报告安全漏洞)
- [范围与非目标](#范围与非目标)

---

## 行为准则

参与本项目即表示你同意遵守 [行为准则](CODE_OF_CONDUCT.md)。请保持专业、友善。

## 我可以贡献什么

- 🐞 **Bug 报告**:用 [Issue](https://github.com/scott987-cmd/feishu-doc-ai-assistant/issues) 描述复现步骤、环境(Chrome 版本、SaaS / 私有化飞书域名、扩展版本)。
- 💡 **功能建议**:先开 Issue 讨论方向,避免做了不被合并。
- 🔧 **代码 PR**:修 bug、加功能、补测试、提升性能。
- 📖 **文档**:`docs/` 下的中英文档(部署 / 开发 / 架构 / 安全)、`README`、FAQ。
- 🌍 **翻译**:中英双语对齐(每篇 `X.md` 都应有对应 `X.en.md`)。

> 商业授权(转售 / 对外 SaaS 等许可证受限用途)咨询请走 [商业授权 Issue 模板](https://github.com/scott987-cmd/feishu-doc-ai-assistant/issues/new?template=commercial.md),不要在普通 Issue 里问。

## 上手开发(必读)

完整开发手册见 **[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)**(仓库地图、数据流、配方、地雷区)。最小迭代循环:

```bash
npm install                 # 首次
# —— 改 src/ 里的代码 ——
npm run typecheck           # ① 必须 0 错(tsc --noEmit)
npm test                    # ② 必须全绿(vitest);新增逻辑要补测试
npm run build               # ③ 必须成功(偶发 TLS 抖动→重试)
npm run test:ui             # ④ 仅当改了侧边栏 UI(puppeteer 冒烟)
npm run validate:server     # ⑤ 仅当改了 docs/*-proxy-server.mjs / docs/admin-*
```

**「完成」的定义 = ①②③ 全过**(动了 UI 加 ④,动了企业服务端加 ⑤)。**typecheck / test 没过不算完成。**

- 不需要真扩展即可预览侧边栏:`npm run dev:ui`(`chrome-mock` 模拟 `chrome.*`)。
- 真机验证:`chrome://extensions` → 开发者模式 → 加载 `dist/` → 打开飞书页面侧边栏。
- 架构见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md);各版本(SaaS / 私有化 / 企业)差异见 [`docs/PRIVATE_DEPLOYMENT.md`](docs/PRIVATE_DEPLOYMENT.md)。

## 不可破坏的安全边界(改前必读)

这些是**代码里硬编码的安全边界**,是本项目对企业用户的核心承诺。任何 PR **触及即必须保留语义并补测试**;逐条说明见 [`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md):

1. **只用用户身份**:`auth.ts` 的 `resolveToken` 绝不回退到 tenant token。
2. **文件级删除一律拒绝**:`agent.ts` 的 `isFileLevelDelete`;内容删除必须走确认门(`DESTRUCTIVE_TOOLS`)。
3. **通用 API 白名单**:`assertApiCallAllowed` / `API_BLOCKED`(禁 IM / 通讯录 / 权限 / 所有权类接口)。
4. **出站只走** `feishuReq` / `feishuFetch`(出站守卫 + 重试 + 私有化版本回退);大模型出站走 `assertSafeBaseUrl`。**别直接 `fetch` 飞书 / 大模型。**
5. **沙箱隔离**:LLM 生成的代码在 opaque origin + `connect-src:'none'` 的 iframe 里跑,**别加 `allow-same-origin`**。
6. **密钥不进明文包**:用加密的 `appSecretEnc` 或 OAuth 代理 `oauthProxyUrl`。
7. **写操作不自动重试**(`robustFetch` 只重试 GET)。

> 改代码后请同步更新相关文档(`README` / `docs/ARCHITECTURE.md` 等)——文档与代码不一致视为未完成。

## 提交 Pull Request

1. **Fork** 仓库,从 `main` 切**新分支**(`fix/...`、`feat/...`、`docs/...`)。
2. 保持 PR **聚焦**:一个 PR 只做一件事,便于审查。
3. **加测试**:新逻辑或修 bug 都应有对应 vitest 用例。
4. 跑完上面的迭代循环,确保 **typecheck / test / build 全绿**。
5. **更新文档**:行为变化要同步 `docs/` 与中英双语。
6. 在 PR 描述里说明:**改了什么、为什么、怎么验证的**;关联相关 Issue。
7. PR 标题建议用 [约定式提交](#提交规范) 前缀。

CI 会对 PR 跑校验(见 `.github/workflows`)。维护者会尽快 review;请耐心并积极回应评审意见。

## 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 风格:

```
feat(slides): 支持深色主题导出
fix(auth): OAuth 缺少 offline_access 导致 2h 失效
docs(deployment): 补充私有化 CIDR 白名单说明
test(redact): 补无条件脱敏用例
```

常用 type:`feat` / `fix` / `docs` / `test` / `refactor` / `perf` / `chore` / `security`。

**DCO 署名**:请用 `git commit -s` 为提交加 `Signed-off-by`,表示你有权按本项目许可证提交该贡献([Developer Certificate of Origin](https://developercertificate.org/))。

## 报告安全漏洞

**请勿在公开 Issue 里报告安全漏洞。** 流程见 [`SECURITY.md`](SECURITY.md):优先用 GitHub 私有安全公告(Security Advisory)私下提交。

## 范围与非目标

为保持产品聚焦与安全承诺,以下属于**非目标**,提 PR 前请先开 Issue 讨论:

- **不引入后端依赖**:核心扩展保持"无后端、用户身份"。企业服务端套件(`docs/*-proxy-server.mjs`)是**可选**、零依赖、开关门控的,不能成为核心必需项。
- **不放宽权限面**:不扩 `manifest` 的 `host_permissions` / `permissions`,不放宽 CSP / 沙箱,不绕过 API 白名单。
- **导入/导出仅限多维表格(Base)**:电子表格 / 文档只做在线 CRUD,不加文件导入导出。
- **不加任何静默上报 / 遥测**:本项目隐私承诺见 [`PRIVACY.md`](PRIVACY.md)。

不确定是否在范围内?**先开 Issue 问**——这比写完被拒更省时间。
