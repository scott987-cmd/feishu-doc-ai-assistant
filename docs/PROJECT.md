> 🌐 [English](PROJECT.en.md) | **中文**

# 飞书文档AI助手 — 项目总文档

> 单文件权威参考。覆盖：项目概览 / 软件架构 / 实现功能 / 安全设计 / 支持场景 /
> 二次开发 / 打包 / 部署 / 配置。
> 配套：模块细节见 [ARCHITECTURE.md](ARCHITECTURE.md)，逐条安全审计见 [SECURITY_AUDIT.md](SECURITY_AUDIT.md)。
> 快照：2026-05-31。测试 177 passed / 32 skipped。

---

## 1. 项目概览

Chrome **MV3 侧边栏扩展**，用自然语言经 AI 操作飞书三大产品：**多维表格(Base)/电子表格
(Spreadsheet)/文档(Docs)**——建表、填数、写公式、生成文档、按评论改稿、跨表查找、去重、审计。

- **形态**：Side Panel（侧边栏）+ Content Script（注入飞书页提取上下文 / DOM 自动化）+
  Background Service Worker（生命周期）。
- **AI**：OpenAI 兼容接口，默认中国大模型（DeepSeek），模型/Key/BaseURL 运行时可配。
- **技术栈**：Vite + React 18 + TypeScript；运行时依赖仅 `react`/`react-dom`/`openai`
  （刻意少依赖，无后端）。
- **打包**：`vite-plugin-web-extension`，`manifest.json` 的 `key` 固定扩展 ID。
- **质量**：177 单测（vitest），关键安全/数据卡点均有覆盖。

---

## 2. 软件架构

### 2.1 MV3 三组件
```
side panel (React)  ←—消息—→  background SW  ←—消息—→  content script (飞书页)
   对话/场景/设置                生命周期               提取 PageContext / DOM 自动化
```

### 2.2 目录结构（src/）
```
shared/
  config.ts            构建时配置 + 派生端点 + 出站白名单（多部署核心）
  crypto.ts            AES-256-GCM（设备种子）—— storage 凭据加密
  url.ts               safeHttpUrl/safeImageSrc —— 不可信 URL 守卫
  providers.ts         大模型厂商预设 + assertSafeBaseUrl（端点校验）
  network.ts           设备 IP/CIDR 内网门
  theme.ts types.ts
  ai/
    agent.ts           Agentic 循环、工具分发、所有安全卡点、系统提示词
    tools.ts           50 个工具的 schema
  feishu/
    auth.ts            resolveToken（用户身份）/ getValidUserToken（自动续期）
    oauth.ts           OAuth + 可选代理 requestToken
    appSecret.ts       密码加密 secret 的运行时解锁
    http.ts api.ts     OpenAPI 封装（robustFetch + 出站守卫）
    sheets.ts docx.ts  电子表格 / 文档底层
    compose.ts         复合算子（去重/跨表/批改/审计，原子性）
    context.ts         fetchBaseCtx 读表结构
    export.ts pageUrl.ts
  templates/
    engine.ts          模板执行引擎（建表+填数+仪表盘）
    registry.ts        远程模板拉取 + sanitize
    builtin/           crm / ecommerce / project 内置模板
sidepanel/
  App.tsx              视图路由 / 上下文检测 / 网络门
  components/          ChatPanel / ScenarioPanel / Settings / MessageList / 各对话框
  sessions/            多会话管理（per-document 绑定 + 上限）
background/ content/   SW + 注入脚本
harness/ dev/          离线测试驱动 / mock
```

### 2.3 Agentic 循环（agent.ts `runAgent`）
1. `assertSafeBaseUrl` 校验大模型端点 → 建 OpenAI client。
2. `buildSystemPrompt`（含上下文 + 安全策略）+ `buildApiHistory`（配对 tool_calls，容截断）。
3. 流式循环：模型产出文本/工具调用 → **安全卡点**（见 §4）→ `executeTool` → 结果回灌 →
   直到无工具调用或达上限（20）。可被 `AbortSignal` 取消（卸载/重发）。
4. 每轮独立气泡按序回显；写操作不重试、创建去重（防重复建表）。

### 2.4 关键数据流
- **Token**：`resolveToken` 永远返回 **user_access_token**（OAuth 或手填），自动续期；
  绝不用 tenant 身份。
- **会话**：按当前文档 appToken 绑定独立会话，每会话最多 20 条（淘汰最旧），
  分片存 `chrome.storage.local`。
- **上下文**：content script / URL 解析出 Base/Sheet/Doc/Wiki；wiki 异步解析有 stale-guard。

---

## 3. 实现功能

### 3.1 工具（50 个，按域）
- **多维表格**：建/改/删表、字段（含单选/多选/日期/关联/公式等类型）、视图、记录
  （单条/批量增改删）、搜索（结构化筛选）、附件等。
- **电子表格**：建表、读写区间、追加行、填充列、查找替换、数字格式、插入/删除行列。
- **文档**：建文档、Markdown 转文档、读正文、插入内容块（段落/标题/列表/引用/代码/分割线/
  待办）、插入表格、删除内容块。
- **复合能力**（compose.ts，带原子性/部分失败上报）：去重、跨表查找、条件批量更新、表→表汇总、审计。
- **通用 API**（`feishu_api_call`）：覆盖不到的需求按官方文档自造请求——**默认拒绝白名单**严格限制。
- **交互**：`ask_user`（弹选择卡）、破坏性删除弹按钮确认。

### 3.2 模板场景（一键建库）
内置 CRM / 电商 / 项目管理；可配远程模板库（registry，带 schema 校验）。失败有重试/返回。

### 3.3 体验
强调色配置、骨架屏、淡入动画、非飞书页面自动暂停显示（侧边栏不开/收起）、
每轮气泡按序、可点 markdown 链接、封面图、导出为模板 JSON。

### 3.4 可选增强（设置里开关）
- **越用越聪明**：每次成功后用模型把「下次怎么做最稳」提炼成一条经验存在本机（最多 300 条、只存做法不存数据；重复任务只累计次数、不重复消耗），下次相似任务自动参考，可清空。
- **Auto 模式**：自动确认文档内的内容删除（行/字段/内容块/去重），不再逐次点确认；
  **文件级删除始终硬拦**，Auto 模式也不放开。默认关。
- **语音输入** 🎤：浏览器语音识别(zh-CN)转文字填入输入框。⚠️ 走 Google 服务、音频外发，
  故仅公网默认构建启用；私有化/锁定构建自动禁用。

---

## 4. 安全设计

> 核心原则：**AI 始终以用户本人身份行事，权限边界全部硬编码在代码里**（提示词只做引导/报错，
> 不作安全边界）。详见 [SECURITY_AUDIT.md](SECURITY_AUDIT.md)。

### 4.1 三条根本原则（代码强制）
- **P1 创建归属用户**：以 user_access_token 操作 → 新建文档自然归用户。
- **P2 文件级删除一律拒绝**：`isFileLevelDelete` 在 agent 循环 + executeTool 双重拦截
  `delete_table`/`delete_sheet`/任何 `feishu_api_call` DELETE；内容级删除（行/字段/块/去重）
  允许但**弹按钮确认**。
- **P3 权限不超用户**：`resolveToken` 只用用户身份，**不回退 tenant**；权限错误如实上报。

### 4.2 防注入 / 越权
- 通用 API **默认拒绝白名单**（仅 bitable/sheets/docx/drive 等业务子路径）+ 硬阻断
  消息/通讯录/权限/所有权 + 路径穿越拦截。
- `isPermissionError` 错误码驱动（精确，少误判）。

### 4.3 数据健壮性
- 批量操作原子性、部分失败 `partial_failure` 上报；写后按实际条数校验；写操作不重试 +
  创建去重（防重复建表/孤儿表）；`robustFetch` 30s 超时、GET 重试。

### 4.4 凭据保护（App Secret 三模式）
| 模式 | 配置 | 包里 | 攻击者拿到包 |
|---|---|---|---|
| 个人·明文 | `VITE_FEISHU_APP_SECRET` | 明文 | 直接 grep ❌ |
| 个人·加密 | `VITE_FEISHU_APP_SECRET_ENC`（`scripts/encrypt-secret.mjs` 生成） | 仅密文 | 需暴破密码（PBKDF2 210k）✅ |
| 企业/私有化·代理 | `VITE_OAUTH_PROXY_URL`（见 `docs/oauth-proxy-worker.js`） | 无 secret | 拿不到 ✅✅ |
- storage 内 token/secret 用 `crypto.ts` AES-256-GCM（PBKDF2(扩展ID+设备种子)）加密。
- user token 自动续期（refresh_token 加密存储），长会话不掉线。

### 4.5 出站与网络锁定
- **只访问两类端点**：飞书 + 大模型。代码层 `isFeishuOutboundAllowed`（基础域名子域）+
  `assertSafeBaseUrl`（大模型）；CSP 层 `connect-src` 按部署锁定（私有化时去掉 `https:` 通配 → 纯内网）。
- 模型端点白名单 `VITE_OPENAI_ALLOWED_HOSTS` 防对话/表格内容外泄。
- 设备内网门 `VITE_ALLOWED_CIDRS`（本机 IP 不在范围则锁扩展）。
- 显式 CSP：`script-src 'self'`（禁内联/eval）、`object-src/base-uri/frame-ancestors` 收紧。
- 远程模板 registry：生产禁 localhost + schema 校验 + 剥离不安全 cover；图片/链接 src 仅 http(s)。

---

## 5. 支持场景（部署矩阵）

| | 个人 | 企业 SaaS | 私有化(on-prem) |
|---|---|---|---|
| App Secret | 明文或**密码加密** | 代理（不进包） | 代理（内网，不进包） |
| `VITE_OAUTH_PROXY_URL` | — | ✓ | ✓（内网） |
| `VITE_FEISHU_BASE_DOMAIN` | feishu.cn（默认） | 默认 | 内网域名（如 test.com） |
| `VITE_OPENAI_ALLOWED_HOSTS` | — | 可选 | 内网大模型 |
| connect-src 锁定 | `https:`（宽） | 可选 | 仅 `*.<域名>`+大模型（纯内网） |
| `VITE_ALLOWED_CIDRS`（设备内网） | — | 可选 | ✓ |
| 分发 | 手动加载/打包 | Chrome 企业策略强制安装 | 同左（内网） |

私有化要点：**只换基础域名后缀**，`open.<域名>`/`accounts.<域名>`/`<租户>.<域名>` 全派生，
API 路径与调用方式完全一致。

---

## 6. 二次开发

### 6.1 本地开发
```bash
npm install
cp .env.example .env.local     # 填配置（见 §9）
npm run dev:ext                # 扩展开发模式（HMR），dist 加载到 chrome://extensions
npm run dev:ui                 # 纯 UI 预览（mock chrome，不连飞书）
npm run typecheck && npm run test
```

### 6.2 加一个工具
1. `shared/ai/tools.ts` 加 schema（name/description/parameters）。
2. `shared/ai/agent.ts` 的 `executeTool` 分发里加实现（或归类到 SHEET_TOOLS/DOC_TOOLS）。
3. 底层调用走 `shared/feishu/api.ts`（Base）或 sheets/docx；**新增删除/写要纳入 §4 卡点**
   （破坏性进 `DESTRUCTIVE_TOOLS`，文件级进 `FILE_LEVEL_DELETE_TOOLS`，创建进 `CREATE_ONCE_TOOLS`）。
4. 补单测。

### 6.3 加一个模板
在 `shared/templates/builtin/` 仿 `crm.ts` 写 `ScenarioTemplate`，在 `builtin/index.ts` 导出。
字段类型码见 ARCHITECTURE；关联/Lookup/公式字段跳过示例数据。或走远程 registry。

### 6.4 加一个大模型厂商
`shared/providers.ts` 的 `LLM_PROVIDERS` 加条目（id/name/baseUrl/models/region）。

### 6.5 测试约定
- 纯逻辑/算子放 `*.test.ts`（vitest node）。
- 组件用 `// @vitest-environment jsdom` + testing-library。
- 需真机/网络的用例标 skip（live.test.ts），靠 harness/driver 离线跑。
- 安全卡点改动会触发对应测试（agent/config/providers/appSecret 等）——红了说明动到了边界。

---

## 7. 如何打包

```bash
# 个人·加密 secret（推荐）：
node scripts/encrypt-secret.mjs          # 输入 secret + 解锁密码 → 得密文
# 写入 .env.local：VITE_FEISHU_APP_SECRET_ENC=<密文>，并清空 VITE_FEISHU_APP_SECRET
npm run build                            # 产物 dist/
```
- `dist/` 即未打包扩展；`manifest.json` 的 `key` 固定 ID（各设备一致 → OAuth 重定向 URL 稳定）。
- 验证：`grep -r <明文secret> dist/` 应**无结果**（加密构建明文不进包）。
- 私有化/代理构建：设对应 env（§9）后 `npm run build`，`vite.config` 会按 env 把
  `host_permissions`/`content_scripts`/`connect-src` 模板化。

---

## 8. 如何部署

### 8.1 自测 / 小范围（加载未打包）
1. 拷 `dist/` 到目标机 → `chrome://extensions` → 开发者模式 → 「加载已解压的扩展程序」。
2. 飞书后台一次性配：**安全设置 → 重定向 URL** 加 `https://<扩展ID>.chromiumapp.org/`（末尾斜杠）。
3. 应用「测试中」阶段：目标账号需加为**测试成员**；scope 在应用后台开启一次。
4. 侧边栏：解锁密钥（加密模式）→ 用飞书账号授权 → 填大模型 Key。

### 8.2 给全员（10 万人）
- **飞书应用**：创建版本 → 提交发布 → 管理员审核 → 设**可用范围**（全员/部门）→ 范围内所有人直接授权，
  **无需逐个加测试成员**；scope/重定向 URL 只配一次。
- **扩展分发**：Chrome 企业策略 **ExtensionInstallForcelist** 由 IT 统一强制安装，用户无需手动加载。
- **去 secret**：用 OAuth 代理（`docs/oauth-proxy-worker.js`，设 `FEISHU_APP_ID/SECRET` 两个服务端 secret）。
- **私有化**：基础域名设内网、`OPENAI_ALLOWED_HOSTS` 设内网大模型、代理设内网 → 纯内网出站。

---

## 9. 如何配置

### 9.1 构建时（`.env.local`，全部可选；见 `.env.example`）
| 变量 | 作用 |
|---|---|
| `VITE_FEISHU_APP_ID` | 飞书 App ID |
| `VITE_FEISHU_APP_SECRET` | 明文 secret（个人·明文；与下两者互斥取一） |
| `VITE_FEISHU_APP_SECRET_ENC` | 密码加密的 secret（个人·加密；`scripts/encrypt-secret.mjs` 生成） |
| `VITE_OAUTH_PROXY_URL` | OAuth 代理地址（企业/私有化，secret 不进包） |
| `VITE_FEISHU_OAUTH_SCOPE` | 空格分隔 scope（bitable:app docx:document sheets:spreadsheet drive:drive wiki:wiki …） |
| `VITE_FEISHU_BASE_DOMAIN` | 飞书基础域名后缀，默认 feishu.cn；私有化填内网域名 |
| `VITE_OPENAI_ALLOWED_HOSTS` | 逗号分隔大模型 host 白名单（设了则 CSP 也锁死 → 纯内网） |
| `VITE_ALLOWED_CIDRS` | 设备内网 CIDR 门（本机 IP 不在范围则锁扩展） |
| `VITE_DEFAULT_REGISTRY_URL` | 默认远程模板库（生产禁 localhost） |

### 9.2 运行时（侧边栏「设置」，不打包）
- 大模型：厂商预设 / Base URL / API Key / Model（默认 DeepSeek）。
- 飞书：解锁密码（加密模式）、用飞书账号授权（OAuth）、open_id、可选手填 user_access_token。
- 强调色、模板库 URL 覆盖。
- 开关：越用越聪明（默认开）、Auto 模式（默认关，含警告）、语音输入（默认开，仅公网构建可见）。

### 9.3 安全约定（务必遵守）
- 凭据文件全部 gitignore：`.env.local`/`*token*.txt`/`feishu-app-config.txt`/`deepseek-*.txt`/
  `unlock-password.txt`/`extension-key.pem`/`*.zip`——**永不入库**。
- 明文与加密 secret **只能留一个**（留明文等于没加密）。
- 解锁密码无法找回（密钥从它派生）；丢了重跑 `encrypt-secret.mjs` 重打包。
- L5（个人·明文模式 secret 在包内）是 MV3 无后端的固有限制，已用「加密 / 代理」两条路提供消除方案。