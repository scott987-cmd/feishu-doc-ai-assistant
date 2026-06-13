<div align="center">

🌐 [English](README.en.md) | **中文**

# 🪶 飞书文档AI助手

**用一句话操作飞书文档 / 多维表格 / 电子表格的 Chrome 侧边栏 AI 助手**

*Feishu Document AI Assistant — operate Docs / Base / Sheet in natural language, from a side panel.*

[![License: Elastic License 2.0](https://img.shields.io/badge/License-Elastic%202.0-005571.svg)](LICENSE)
![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4285F4?logo=googlechrome&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![React 18](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-build-646CFF?logo=vite&logoColor=white)
![Tests](https://img.shields.io/badge/tests-371%20passing-success)
![No backend](https://img.shields.io/badge/backend-none-lightgrey)

</div>

用自然语言经 AI 直接操作**飞书多维表格(Base) / 电子表格(Sheet) / 文档(Docs)**——
建表、填数、写公式、生成文档、按评论改稿、跨表查找、去重、审计，一句话搞定。

- **🤖 AI**：OpenAI 兼容接口，默认中国大模型（DeepSeek），模型 / Key / Base URL 运行时可配。
- **🧩 形态**：侧边栏 + 注入飞书页的内容脚本 + 后台 Service Worker。运行时依赖仅 React + openai SDK，**无后端**。
- **🔒 安全优先**：助手始终以**用户本人身份**操作、绝不越权；所有权限边界**硬编码在代码里**（提示词不作安全边界）。

## 🎬 演示

[![观看演示视频](https://img.youtube.com/vi/JhPNeOK1n8g/hqdefault.jpg)](https://youtu.be/JhPNeOK1n8g)

▶️ [YouTube 观看](https://youtu.be/JhPNeOK1n8g) ·  打不开 YouTube？[下载本地演示 mp4](docs/media/demo.mp4)

> 📚 **完整文档** → [`docs/PROJECT.md`](docs/PROJECT.md)（架构 / 功能 / 安全 / 部署 / 配置一站式）
> · **部署指南（企业/个人/私有化快速上手）** [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
> · 使用手册（含截图）[`docs/USER_GUIDE.md`](docs/USER_GUIDE.md)
> · 模块细节 [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) · 安全审计 [`SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md)
> · 企业 MDM 强制安装 [`docs/enterprise/DEPLOY.md`](docs/enterprise/DEPLOY.md)

---

## 🚀 个人快速上手

> 🟢 **免构建（装商店版）**：从 **[Chrome 网上应用店](https://chromewebstore.google.com/detail/eplcnheinfmkcckelinolhpdagbamdcc)** 点「添加至 Chrome」省去克隆/打包/加载。商店版**不内置凭据**，仍用**你自己的**飞书应用：先按下方**第 1 步**建应用，再在扩展「设置 → 自建飞书应用」填 **App ID/Secret** + 登记设置里显示的回调 + 飞书授权 + 大模型 Key。用法见 [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md)。

### 自行构建 / 用自己的飞书应用（5 步）

> 想把 App ID/Secret 直接**打进包**（免去每台设备在设置里填）、二次开发、或私有化时才需要。完整版（每个权限的说明、加密模式、排错）见 [`docs/QUICKSTART.md`](docs/QUICKSTART.md)。

1. **配飞书应用**（[open.feishu.cn](https://open.feishu.cn) → 创建企业自建应用）：记下 App ID / Secret；「权限管理」开通 `offline_access`（必须）+ 按需 `bitable:app` `docx:document` `sheets:spreadsheet` `drive:drive` `wiki:wiki` `contact:user.base:readonly`（**都勾「用户身份」**）；「重定向 URL」加 `https://jhdbgegkmhcopcilclkpioilclemkeog.chromiumapp.org/`；把自己加进「可用范围」并**发布**。
2. **填配置**：`cp .env.example .env.local` → 填 `VITE_FEISHU_APP_ID` + `VITE_FEISHU_APP_SECRET`（或 `node scripts/encrypt-secret.mjs` 出密文填 `VITE_FEISHU_APP_SECRET_ENC`、明文留空）。
3. **一键打包**：`npm install && npm run pack`（产出 `dist/` 与 `feishu-doc-ai-assistant.zip`）。
4. **加载**：`chrome://extensions` → 开发者模式 → 「加载已解压」→ 选 `dist/`。
5. **用**：打开飞书 多维表格/文档 → 侧边栏 → 设置里「飞书授权」+ 填大模型 Key →（加密模式先输解锁密码）→ 一句话开干。

---

## 功能

- **AI 对话操作**：~50 个工具覆盖多维表格(建/改表、字段、视图、记录增改删、结构化搜索)、
  电子表格(读写区间、填列、查找替换、行列增删)、文档(Markdown 转文档、插入各类内容块、按评论改稿)。
- **复合能力**：去重 / 跨表查找 / 条件批量更新 / 表→表汇总 / 审计（带原子性与部分失败上报）。
- **通用 API**：覆盖不到的需求按官方文档自造请求——**默认拒绝白名单**严格限制。
- **场景模板**：内置 CRM / 电商 / 项目管理，可配远程模板库，一键建库（表结构 + 示例数据 + 仪表盘）。
- **越用越聪明**：每次成功后把「下次怎么做最稳」用模型**提炼成一条经验**存在**本机**（最多 300 条、只存做法不存数据），
  下次相似任务自动参考、少走弯路；重复任务只累计次数不重复消耗，可关闭/清空。
- **Auto 模式**：自动确认文档内的内容删除（文件级删除始终硬拦）；**语音输入** 🎤（公网构建，zh-CN）。
- **网页剪藏** 📎：在任意网页右键 / 快捷键，把选中内容或整页表格 **AI 整理后写入飞书多维表格 / 电子表格 / 文档**；也可拖入 CSV 文件导入。
  仅在你**手势触发**时读取**当前页** DOM（`activeTab`，本地、无新增出站、无需放开 host_permissions）；发送前先**预览**。
- **AI 小程序** 🧩：一句话把当前表做成飞书页面上的悬浮窗小程序（可拖拽/四角缩放）——
  **图表看板**(ECharts) / **计算器·交互工具** / **可打印报表**(window.print) / **汇报幻灯片** / **卡片墙·时间线等自定义视图**。
  生成代码与数据**分离**——保存后下次用**最新数据**一键打开、零 LLM；一页可挂多个独立小程序（各自浮标）；
  代码跑在 **MV3 沙箱**（null 源、`connect-src 'none'`）里**只读渲染**，**拿了数据也发不出去**。详见 [`ARCHITECTURE.md`](docs/ARCHITECTURE.md)。
- **AI 建站** 🌐：一句话（可附**参考站点 URL** 作风格提示）把当前表做成一个**完整的网站页面**（导航 / 英雄区 / 指标卡 / 明细表），
  渲染成页面浮窗。沙箱里**预置了一套设计系统**——即使描述很简略也能生成**好看、统一、符合插件风格**的页面；
  **离线自包含**（系统字体、无外链/CDN）、数据绑定（重开拉最新数据）、可先出方案确认、可用语言微调、可保存。
- **AI 智能填充** 🪄：在**多维表格 / 电子表格**里选一列，AI 参考同行其它列（和你已填好的示例）推断该列**空缺**的值——
  自动分类 / 打标签 / 归类 / 补全。**预览每一处再写回**；单选/多选只会落到**已有选项**（绝不新建），数字/日期解析失败即跳过；
  仅**更新**、以用户身份、只动当前表（默认只填空白格）；写入数**按飞书实际确认计数**，不会虚报。
- **数据分析报告** 📈：读当前**多维表格 / 电子表格**的数据，本地先算统计摘要，AI 写一篇**带真实数字**的分析报告
  （摘要 / 关键发现 / 趋势异常 / 建议），生成飞书**文档**并在文末附上源数据表。飞书有「引用」但没有 AI 数据叙事——这是结合表格 + 文档写入的闭环。
- **文档体检** 🩺：通读当前文档，AI 找出**逻辑断点 / 未定义术语 / 前后矛盾 / 遗留 TODO / 过期数据 / 空小节**，
  给出按严重度排序、可定位的问题清单（只读、不改文档）。文档版的 `auditTable`，飞书无系统化审稿。
  **检查项可直接点开编辑、本机持久化**——你定义体检什么。
- **文档总结** 📝：通读当前文档，按你的要求生成总结（摘要 / 要点 / 待办…），可复制。
  **总结要求（prompt）可直接编辑、本机持久化**——飞书原生 AI 速览是固定的，这里你说了算。
- **三种部署**：个人 / 企业 SaaS / 私有化（on-prem），全部构建时配置切换。
- **企业服务端套件** 🏢（可选·一个零依赖 Node 进程）：在换 token 代理上同进程挂载 ——
  **统一下发 App ID / App Secret / LLM / 策略**（员工免配置、密钥只在服务端、可轮换）、
  **共享技能库**（多用户脱敏经验汇聚·去重·打分·晋级·主动推送）、
  **企业云备份**（小程序/建站/PPT 镜像到企业自有对象存储、按 open_id 隔离·可选 AES、丢失可拉回）、
  **运维管理台**（`/admin`：看板 / 技能审核 / 备份管理 / 配置巡检 / 审计）。
  全部 `HAS_* = 开关 && 有代理` **双门控**，商店版无代理 → **死代码消除、发版零影响**。详见 [`docs/index.html`](docs/index.html)。
- **本地备份与恢复** 💾（所有版本）：把配置 + 保存的小程序/建站/PPT + 本地经验 + 会话**导出成文件**，换设备/重装后导入恢复，防个人数据丢失（密钥默认不导出，可勾选）。

---

## 快速开始（开发）

```bash
npm install
cp .env.example .env.local      # 按需填写（见下方「配置」），可全空先跑通
npm run build                   # 产物 dist/
# chrome://extensions → 开发者模式 → 「加载已解压的扩展程序」→ 选 dist/
```

开发与质量：
```bash
npm run dev:ext     # 扩展热更新（加载到 Chrome）
npm run dev:ui      # 纯 UI 预览（mock chrome，不连飞书）
npm run typecheck && npm run test
```

> 企业内部分发（不上架商店、不用开发者模式）见 [`docs/enterprise/DEPLOY.md`](docs/enterprise/DEPLOY.md)：
> 用项目脚本打 `.crx` + Chrome 策略强制安装（含现成 macOS `.mobileconfig`）。

---

## 配置（全部可选，见 [`.env.example`](.env.example)）

**运行时**（侧边栏 → 设置）：大模型供应商 / Base URL / API Key / 模型；飞书账号授权；强调色；
模板库地址；「越用越聪明」开关。

**构建时**（`.env.local`，决定部署形态）：

| 变量 | 作用 |
|---|---|
| `VITE_FEISHU_APP_ID` | 飞书 App ID |
| `VITE_FEISHU_APP_SECRET` | 明文 secret（个人·明文，会进包） |
| `VITE_FEISHU_APP_SECRET_ENC` | 密码加密的 secret（个人·加密，`scripts/encrypt-secret.mjs` 生成） |
| `VITE_OAUTH_PROXY_URL` | OAuth 代理地址（企业/私有化，secret 不进包，见 `docs/oauth-proxy-worker.js`） |
| `VITE_FEISHU_BASE_DOMAIN` | 飞书基础域名后缀，默认 `feishu.cn`；私有化填内网域名（派生 `open.<域名>` 等） |
| `VITE_OPENAI_ALLOWED_HOSTS` | 大模型 host 白名单（设了则 CSP 也锁死 → 纯内网） |
| `VITE_ALLOWED_CIDRS` | 设备内网 CIDR 门 |
| `VITE_MAX_TOOL_CALLS` | 单轮工具调用上限（默认 30） |
| `VITE_CLIP_ENABLED` | 网页剪藏开关（默认开；设 `false` 不带剪藏功能） |

---

## 安全设计（要点）

助手**以用户本人 user_access_token 操作**，权限边界全部代码强制：

- **身份不超用户**：用户读不了的文档 AI 也读不了；不回退应用(tenant)身份。
- **禁文件级删除**：绝不删整表/电子表格/文档/云文件；内容级删除需按钮确认。
- **防注入**：通用 API 默认拒绝白名单 + 硬阻断消息/通讯录/权限/所有权。
- **凭据保护**：storage 内 AES-256-GCM；App Secret 支持明文 / 密码加密 / 代理三档。
- **出站锁定**：只访问飞书 + 大模型两类端点（代码层白名单 + CSP 双重，私有化可纯内网）。

逐条见 [`SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md)。

---

## 想给自己的组织打包？（fork / 自建）

> 🧰 **不想碰命令行？** 跑 `npm run package:ui` 打开图形化**打包向导**（仅本机 `http://localhost:8799`）：
> 选模式（企业/个人/商店/私有化）→ 改名称、上传图标、勾选参数 → **一键打包下载 `.zip`**。
> 底层即驱动下方的 `npm run build`，产物一致。详见[完整指南 · 打包向导](https://scott987-cmd.github.io/feishu-doc-ai-assistant/docs/index.html#package-wizard)。

本仓库 `manifest.json` 的 `key` 与 `extension-key.pem`（已 gitignore）固定了**作者的**扩展 ID。
自建分发时请**生成你自己的签名密钥**并替换：

```bash
# 1) 生成你自己的私钥
openssl genrsa 2048 > my-extension-key.pem
# 2) 取它的公钥(base64 DER) 替换 manifest.json 的 "key" 字段
openssl rsa -in my-extension-key.pem -pubout -outform DER | openssl base64 -A
# 3) 用你的私钥打 .crx（见 docs/enterprise/DEPLOY.md）
```

这样你拥有独立的扩展 ID 与签名权，能自行平滑更新。**切勿提交任何 `*.pem` / `.env.local` /
解锁密码到仓库**（已在 `.gitignore`）。

---

## 文档导航

> 📖 **完整文档（离线单页 HTML，零依赖）**：[`docs/index.html`](docs/index.html) —— 使用 / 部署 / 架构 / 安全 一站读完，浏览器直接打开。
>
> 🌐 **在线文档站**：本仓库所有 Markdown 已可一键生成静态站并**免费托管在 GitHub Pages**——
> `npm run docs:html`（零依赖，产物在 `site/`）本地预览；推送到 `main` 由 [`.github/workflows/pages.yml`](https://github.com/scott987-cmd/feishu-doc-ai-assistant/blob/main/.github/workflows/pages.yml) 自动构建发布。
> 一次性开启：仓库 **Settings → Pages → Source = "GitHub Actions"**，之后访问 `https://<用户名>.github.io/<仓库名>/`。

| 文档 | 内容 |
|---|---|
| [`docs/index.html`](docs/index.html) | **完整文档站**（单文件 HTML）：概览 / 使用 / 部署（个人·企业套件·商店·私有化）/ 架构 / 安全 / 管理台 / 验证 / FAQ |
| [`docs/QUICKSTART.md`](docs/QUICKSTART.md) | **个人快速部署**：配飞书应用权限 → 填配置 → `npm run pack` 一键打包 → 加载使用（5 步） |
| [`docs/STORE_PUBLISHING.md`](docs/STORE_PUBLISHING.md) | **上架 Chrome 商店**：零凭据公开版构建 + 用户自带应用首配 + 上架清单 + 审核风险规避 |
| [`PRIVACY.md`](PRIVACY.md) | **隐私政策**（中英）：上架必填的隐私权 URL，可直接托管使用 |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | **部署指南**：企业 / 个人 / 私有化快速上手（选路 + 命令 + 变量速查） |
| [`docs/PRIVATE_DEPLOYMENT.md`](docs/PRIVATE_DEPLOYMENT.md) | **私有化专用**：内网/私有化飞书完整方案（出站锁定 / 代理 / 版本回退 / 验证清单） |
| [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) | **使用手册**：全功能图文说明（含截图） |
| [`docs/FAQ.md`](docs/FAQ.md) | **常见问题**：鉴权/导出/升级/私有化 排错 |
| [`CLAUDE.md`](CLAUDE.md) · [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | **开发手册**：面向 agent 的快速迭代（循环 / 仓库地图 / 硬约束 / 地雷区） |
| [`docs/PROJECT.md`](docs/PROJECT.md) | **一站式**：架构 / 功能 / 安全 / 部署 / 配置 |
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 深水区：模块结构、工具清单、字段类型、API 实测坑、模板引擎内部 |
| [`SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md) | 安全设计逐条审计 + 攻击场景 + 修复（含 App Secret/OAuth 图解） |
| [`docs/enterprise/DEPLOY.md`](docs/enterprise/DEPLOY.md) | 企业内部分发（.crx + Chrome 策略强制安装，含 macOS `.mobileconfig`） |
| [`docs/oauth-proxy/`](docs/oauth-proxy/) · [`docs/oauth-proxy-server.mjs`](docs/oauth-proxy-server.mjs) | OAuth 代理：自托管 Node（Docker/nginx）+ Cloudflare 版，secret 不进包 |
| [`docs/skill-proxy-server.mjs`](docs/skill-proxy-server.mjs) · [`docs/artifact-proxy-server.mjs`](docs/artifact-proxy-server.mjs) | 企业服务端套件：共享技能库 / 企业云备份（与 oauth 代理同进程挂载，零依赖） |
| [`docs/admin-server.mjs`](docs/admin-server.mjs) · [`docs/admin-ui.html`](docs/admin-ui.html) | 运维管理台：单页 + 签名会话鉴权（看板/技能审核/备份管理/配置/审计） |
| [`docs/sim/validate-server.mjs`](docs/sim/validate-server.mjs) | 合成数据服务端验证器（`npm run validate:server`，无需真飞书） |
| [`.env.example`](.env.example) | 全部构建时配置项 |
| [`CHANGELOG.md`](docs/CHANGELOG.md) | 版本更新日志 |

---

## 贡献

欢迎 Issue / PR。提交前请跑通：

```bash
npm run typecheck && npm run test && npm run build
```

> 改动若涉及安全卡点（`isFileLevelDelete` / `assertApiCallAllowed` / `resolveToken` /
> `assertSafeBaseUrl` 等），请同步更新 [`SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md) 与对应单测。
> **切勿提交任何密钥 / 密码 / 私钥**（`.gitignore` 已覆盖 `*.pem` / `*password*.txt` / `.env.*` 等）。

## ⚠️ 免责声明

本工具通过大模型对你的飞书数据执行真实操作（建表、写入、删除内容等）。虽然内置了
「文件级删除一律拒绝」「内容删除需确认」「以用户本人权限操作」等多重护栏，**仍建议在重要数据上
谨慎使用、必要时先备份**。开启「Auto 模式」会跳过内容删除的逐次确认，请知悉风险。
作者不对因使用本工具造成的数据损失负责（详见 [`LICENSE`](LICENSE)）。

## 许可证

[Elastic License 2.0](LICENSE) © 2026 [scott987-cmd](https://github.com/scott987-cmd) — **源代码可见**（非 OSI 严格意义的"开源"；与 Elasticsearch 同款协议）。

一句话（以 [`LICENSE`](LICENSE) 原文为准）：**个人 / 企业均可免费使用、复制、修改、分发、自行部署（含公司内部商用）；
唯独禁止「把它作为托管 / SaaS 服务提供给第三方」**，且不得绕过授权功能、不得去除版权/许可标识。

### 商业授权
需要「作为托管 / SaaS 服务对外提供」等受限用途授权？
请在本仓库 **GitHub Issues 开一个标注 `commercial` 的 issue**（说明用途与规模）联系作者 [scott987-cmd](https://github.com/scott987-cmd) 洽谈。

> 🍴 Fork / 二次分发：必须替换 `manifest.json` 的 `key`（换成你自己的扩展 ID/签名私钥）并改掉文档中的扩展 ID / 重定向 / `ALLOW_ORIGIN` 占位，详见 [`docs/DEPLOYMENT.md` §5](docs/DEPLOYMENT.md)。
