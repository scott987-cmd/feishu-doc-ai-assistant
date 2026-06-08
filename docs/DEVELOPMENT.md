# 开发手册（面向 AI agent 的快速迭代指南）

> 目标：让一个**新接手的 agent** 在几分钟内能安全地改代码、验证、不破坏既有约束。
> 深水区结构见 [`../ARCHITECTURE.md`](../ARCHITECTURE.md)；一站式总览见 [`PROJECT.md`](PROJECT.md)；
> 安全逐条见 [`../SECURITY_AUDIT.md`](../SECURITY_AUDIT.md)；部署见 [`DEPLOYMENT.md`](DEPLOYMENT.md)。

---

## 0. 这是什么

Chrome **MV3** 扩展「飞书文档AI助手」：在飞书 多维表格/电子表格/文档 页用自然语言让 AI 操作，并能把数据做成 网站/看板/PPT。**无后端**，全部以**用户本人飞书身份**操作。技术栈：React 18 + TS + Vite + vitest + ECharts。

---

## 1. 迭代循环（最重要——照这个做）

```bash
npm install                 # 首次
# —— 改 src/ 里的代码 ——
npm run typecheck           # ① 必须 0 错（tsc --noEmit）
npm test                    # ② 必须全绿（vitest，~355 用例）；新增逻辑要补测试
npm run build               # ③ 必须成功（偶发 TLS 报错→直接重试，是 manifest 插件联网抖动）
npm run test:ui             # ④ 改了侧边栏 UI 才需要（puppeteer 冒烟，11 项）
# 真机验证：chrome://extensions → 开发者模式 → 加载 dist/ → 打开飞书页面侧边栏
```

**「完成」的定义**：①②③ 全过（动了 UI 再加 ④）。**不要**在 typecheck/test 没过时就说做完了。

预览不需要真扩展：`npm run dev:ui`（用 `src/dev/chrome-mock.ts` 模拟 chrome.*，浏览器直接看侧边栏）。

---

## 2. 仓库地图（去哪找）

| 路径 | 职责 |
|---|---|
| `src/sidepanel/` | React 侧边栏 UI。`components/*Panel.tsx` 是各功能面板；`App.tsx` 顶层 + 鉴权横幅 |
| `src/background/` | Service Worker：消息路由、`RESOLVE_PAGE_RESOURCE`（wiki→真实资源）、剪藏/截图、写回桥 |
| `src/content/` | 注入飞书页的内容脚本。`viz-overlay.ts`=可拖拽浮窗（承载 sandbox iframe）；页面上下文识别 |
| `src/sandbox/` | **沙箱 iframe**（opaque origin, `connect-src:'none'`）。`main.ts` 跑 LLM 生成的可视化/建站/PPT 代码；`index.html` 内含设计系统 CSS + ECharts |
| `src/shared/ai/` | `agent.ts`（~50 工具的 tool-calling 主循环，1.3k 行）、`llm.ts`、`slides.ts`、`dataviz.ts`、`docaudit/summary.ts`、`*Store.ts`、`recipes.ts` |
| `src/shared/feishu/` | `api.ts`(bitable)、`sheets.ts`、`docx.ts`、`http.ts`(`feishuReq`/`feishuFetch`)、`auth.ts`(token 生命周期)、`oauth.ts`、`appSecret.ts`、`version.ts`(私有化版本回退)、`pageUrl.ts` |
| `src/shared/dataviz/` | `store.ts`(已存看板/网站, `dataviz_v1`)、`scope.ts`(归属当前表)、`send.ts`、`data.ts` |
| `src/shared/` | `config.ts`(所有 `VITE_*` → `BUILD_CONFIG`)、`crypto.ts`(设备加密)、`theme.ts`(配色)、`types.ts` |
| `src/shared/{templates,smartfill,report,clip}/` | 模版库 / 智能填充 / 数据报告 / 网页剪藏 |
| `scripts/` | `ui-smoke.mjs`、`capture-screenshots.mjs`、`encrypt-secret.mjs`、`check-perm.mjs` |
| `vite.config.ts` | 生产构建 + `transformManifest`（CSP/host_permissions/sandbox 都在这里按 env 生成）|

---

## 3. 数据流（一图）

```
侧边栏(React) ──消息──▶ 后台 SW ──▶ 飞书 OpenAPI（用户 token）
     │                                  ▲
     │ 生成代码 {code,data}              │ feishuReq/feishuFetch（出站守卫+重试+版本回退）
     ▼                                  │
内容脚本 viz-overlay ──▶ 沙箱 iframe（跑生成代码、connect-src:none、只回 {ok/err}/写回草稿）
```
- 沙箱**只**收 `{code,data}`、回 `{ok/err}`；它拿不到 chrome.*/token。
- 跨帧消息有 nonce/source 校验（见 `viz-overlay.ts` 与 `sandbox/main.ts` 的 message 监听）。

---

## 4. 硬约束（**改前必读，别破坏**）

这些是**代码里硬编码的安全边界**，提示词不作数。改动若触及，必须保留语义并补测试：

1. **永远以用户身份**：`auth.ts resolveToken` 只返回 user_access_token，**绝不回退 tenant**。
2. **文件级删除一律拒绝**：`agent.ts isFileLevelDelete`（`delete_table`/`delete_sheet`/任何 `feishu_api_call` DELETE）双重拦截。内容级删除（行/字段/块/去重）进 `DESTRUCTIVE_TOOLS`，**确认门**后才执行。
3. **通用 API 白名单 + 硬禁**：`assertApiCallAllowed`/`API_BLOCKED` 拦截 消息(`im`)/通讯录/权限/所有权/路径穿越。
4. **出站锁定**：所有飞书请求走 `feishuReq`/`feishuFetch`（`isFeishuOutboundAllowed` 守卫）；大模型由 `assertSafeBaseUrl` 限制。别绕过它们直接 `fetch`。
5. **沙箱隔离**：生成代码跑在 opaque origin + `connect-src:'none'`。**不要**给沙箱加 `allow-same-origin` 或放开 connect-src。
6. **secret 不进明文包**：直连用密码加密(`appSecretEnc`)或代理(`oauthProxyUrl`)；明文 `VITE_FEISHU_APP_SECRET` 仅本地联调。
7. **写操作不自动重试**：`http.ts robustFetch` 对 POST/PUT/PATCH/DELETE 只发一次（超时的创建可能已成功）。

> 改这些区域时，README 顶部也提示：涉及 `isFileLevelDelete`/`assertApiCallAllowed`/`resolveToken` 的改动要格外谨慎并补 harness。

---

## 5. 常见改法（配方）

- **加一个 AI 工具**：在 `agent.ts` 的工具定义数组加 schema + 在 `executeTool` 加分支；按性质加入 `DESTRUCTIVE_TOOLS`/`WRITE_TOOLS`/`FILE_LEVEL_DELETE_TOOLS`/`CREATE_ONCE_TOOLS`；补 `agent.test.ts`。
- **加一个飞书 API**：在 `api.ts`/`sheets.ts`/`docx.ts` 写 wrapper，**必须**用 `feishuReq`/`req`（自带出站守卫+版本回退）。路径写当前 SaaS 版本（如 `/bitable/v1/...`），私有化回退自动处理。
- **加一个侧边栏面板**：在 `src/sidepanel/components/` 新建 `XxxPanel.tsx`，挂进 `ScenarioPanel.tsx`（按 `requires: 'table'|'doc'|'any'|'content'` 分组、上下文感知）。生成类要处理 busy/取消/缓存恢复/`isTokenExpiredError` 错误文案。
- **改沙箱渲染（看板/网站/PPT）**：逻辑在 `sandbox/main.ts`（`ui.*` 助手、`render()`、message 监听）；样式在 `sandbox/index.html` 的设计系统 CSS。浮窗 chrome（🖨/🎨/✕/提交）在 `content/viz-overlay.ts`。
- **改配色/主题**：`shared/theme.ts`（`deriveAccent` 侧栏、`vizAccent` 沙箱）。
- **加构建配置**：在 `config.ts BUILD_CONFIG` 读 `import.meta.env.VITE_XXX`，并在 `.env.example` 记录；若影响 CSP/host，改 `vite.config.ts`。

---

## 6. 地雷区（历史踩过的坑——优先怀疑这些）

| 现象 | 真因 / 处置 |
|---|---|
| 导出 PDF（🖨）没反应 | sandbox 需 `allow-modals`，**两层都要**：`viz-overlay.ts` iframe 属性 + `vite.config.ts` 的 CSP `sandbox` 指令（取交集）。 |
| token ~2h 失效(`99991677`) | OAuth 必须含 `offline_access` 才发 refresh_token。`oauth.ts` 已**强制**请求；改授权逻辑勿删。 |
| 私有化某端点 404 | `feishuFetch` 的 `/vN/`→`v(N-1)` 回退（`version.ts`），仅 `IS_PRIVATE_DEPLOY` 生效。 |
| 环境变量没生效 | **Vite 只读 `.env` 文件里的 `VITE_*`，不读 `process.env`**。多套配置用 `.env.<mode>.local` + `vite build --mode <mode>`。 |
| `npm run build` 偶发 TLS 报错 | manifest 插件联网抖动，**直接重试**即可。 |
| 写操作重复（建了两张表） | 别给写方法加重试（`robustFetch` 故意只对 GET 重试）。 |
| 沙箱里 echarts 不显示/打印缺图 | 容器要有真实尺寸再 `init`；打印走 `@media print` + 一页一张栈（见 `index.html`/`main.ts` slidesPrint）。 |
| dev:ui 崩溃 `chrome.X is not a function` | `src/dev/chrome-mock.ts` 缺对应 API，补齐 mock。 |
| 改了品牌名/文案，ui-smoke 挂 | `scripts/ui-smoke.mjs` 里有断言（如品牌名），同步改。 |

---

## 7. 测试约定

- 纯逻辑（`version.ts`/`scope.ts`/`crypto` 等）：`*.test.ts` 单测，**首选**。
- 需要 chrome/config 的：用 `vi.mock('../config', ...)` 注入（见 `http.version.test.ts` 强制 `IS_PRIVATE_DEPLOY`）。
- UI：`MessageList.test.tsx` 等用 jsdom + testing-library；整体渲染用 `npm run test:ui`。
- 视觉（沙箱渲染/打印/配色）：用 puppeteer + `page.emulateMediaType('print')`/截图，临时脚本验证（参考会话里 `_print_diag`/`_accent_shot` 写法）。
- 飞书实测：`FEISHU_LIVE=1 npx vitest run src/shared/feishu/live.test.ts`（需 `feishu-app-config.txt`）。

---

## 8. 配置与密钥（速记）

- 全部构建变量在 [`../.env.example`](../.env.example)；运行时读 `config.ts BUILD_CONFIG`。
- 关键派生：`HAS_BUILTIN_CREDS`、`HAS_ENCRYPTED_SECRET`、`IS_PRIVATE_DEPLOY`、`FEISHU_API_BASE`、`OAUTH_PROXY_HOST`。
- 持久化都在 `chrome.storage.local`，键带 `_v1`（更新不丢；改 schema 记得迁移，别裸升 `_v2`）。
- secret：`encrypt-secret.mjs` 生成密文 → `VITE_FEISHU_APP_SECRET_ENC`；解密在 `appSecret.ts`（PBKDF2 210k→AES-GCM）。

---

## 9. 出问题先看哪

| 症状 | 先看 |
|---|---|
| 鉴权/401/续期 | `feishu/auth.ts` + `oauth.ts`（scope 含 offline_access?） |
| 某飞书调用失败 | `feishu/http.ts`（出站守卫/版本回退）+ 对应 `api/sheets/docx.ts` wrapper |
| 工具行为/确认门 | `ai/agent.ts`（工具集、`executeTool`、`*_TOOLS` 集合） |
| 看板/网站/PPT 渲染或导出 | `sandbox/main.ts` + `sandbox/index.html` + `content/viz-overlay.ts` |
| 面板/分组/上下文 | `sidepanel/components/ScenarioPanel.tsx` + 各 `*Panel.tsx` |
| CSP/权限/host | `vite.config.ts transformManifest` + 构建后的 `dist/manifest.json` |

---

## 10. 提交前自检清单

- [ ] `npm run typecheck` 0 错
- [ ] `npm test` 全绿（新逻辑有测试）
- [ ] `npm run build` 成功
- [ ] 动了 UI：`npm run test:ui` 11/11
- [ ] 未触碰/未削弱第 4 节硬约束（触碰则已补测试 + 在 PR/说明里点明）
- [ ] 动了文案/品牌：同步 `ui-smoke.mjs` 断言与相关文档
