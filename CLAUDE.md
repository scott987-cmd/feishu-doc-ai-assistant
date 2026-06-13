# CLAUDE.md — agent 快速上手

Chrome **MV3** 扩展「飞书文档AI助手」：在飞书 多维表格/电子表格/文档 页用自然语言操作，并把数据做成 网站/看板/PPT。**无后端**，全部以**用户本人飞书身份**操作。React 18 + TS + Vite + vitest + ECharts。

> 详尽开发指南见 **[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)**（仓库地图、配方、地雷区、调试入口）。
> 还有：[`ARCHITECTURE.md`](docs/ARCHITECTURE.md)（深结构）· [`SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md)（安全）· [`docs/FAQ.md`](docs/FAQ.md) · [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。

## 迭代循环（每次改完都跑）
1. `npm run typecheck` — 必须 0 错
2. `npm test` — 必须全绿（~460 用例；新逻辑补测试）
3. `npm run build` — 必须成功（偶发 TLS 报错→重试）
4. 动了侧边栏 UI 再跑 `npm run test:ui`（11 项冒烟）
5. 动了 `docs/*-proxy-server.mjs` / `docs/admin-*` 再跑 `npm run validate:server`（29 条合成数据端到端断言，无需真飞书）

预览：`npm run dev:ui`（chrome-mock，浏览器直看侧边栏，无需真扩展）。
完整文档（使用/部署/架构/安全，单文件 HTML）：`docs/index.html`。

## 企业服务端套件（可选·`docs/` 下零依赖 Node，全部开关门控、商店版死代码消除）
`oauth-proxy-server.mjs` 同进程挂载：换 token + 托管 App ID(`app_config`)/LLM/策略 · 技能库(`/skills/*`,
`skill-proxy-server.mjs`) · 云备份(`/artifacts/*`, `artifact-proxy-server.mjs`) · 管理台(`/admin`,
`admin-server.mjs`+`admin-ui.html`)。客户端门控：`HAS_SKILLS`/`HAS_ARTIFACT_SYNC`/`HAS_MANAGED_APP_ID`
= `开关 && oauthProxyUrl`（`config.ts`）。改完务必 store 构建复核端点串为 0。

## 别破坏的硬约束（代码里硬编码的安全边界）
1. **只用用户身份**：`auth.ts resolveToken` 绝不回退 tenant。
2. **文件级删除一律拒绝**：`agent.ts isFileLevelDelete`；内容删除走确认门（`DESTRUCTIVE_TOOLS`）。
3. **通用 API 白名单**：`assertApiCallAllowed`/`API_BLOCKED`（禁 im/通讯录/权限/所有权）。
4. **出站只走** `feishuReq`/`feishuFetch`（出站守卫+重试+私有化版本回退），大模型走 `assertSafeBaseUrl`。别直接 `fetch` 飞书。
5. **沙箱隔离**：生成代码在 opaque origin + `connect-src:'none'`，别加 `allow-same-origin`。
6. **secret 不进明文包**（加密 `appSecretEnc` 或代理 `oauthProxyUrl`）。
7. **写操作不自动重试**（`robustFetch` 只重试 GET）。

## 高频地雷（先怀疑）
- 导出 PDF 没反应 → sandbox `allow-modals` 需 iframe 属性 + `vite.config.ts` CSP 两层都有。
- token 2h 失效 → OAuth 必须含 `offline_access`（`oauth.ts` 已强制）。
- 环境变量没生效 → **Vite 只读 `.env` 文件的 `VITE_*`，不读 `process.env`**；用 `--mode` + `.env.<mode>.local`。
- 私有化端点 404 → `feishuFetch` 自动 `/vN/`→`v(N-1)` 回退（仅 `IS_PRIVATE_DEPLOY`）。

## 约定
- 配置：`config.ts BUILD_CONFIG`（读 `import.meta.env.VITE_*`），记录在 `.env.example`。
- 持久化：`chrome.storage.local`，键带 `_v1`（版本更新不丢；改 schema 要迁移）。
- 提交结束语：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 仅在用户要求时才 commit/push；先开分支再改默认分支。
