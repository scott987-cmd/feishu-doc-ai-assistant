> 🌐 [English](ENTERPRISE.en.md) | **中文**

# 企业部署指南（私有化 / SaaS / 托管,面向万人级组织）

> 面向平台 / IT / 安全团队。本文讲清三件事:**各版本(SaaS vs 私有化 vs 企业托管)到底差在哪**、
> **企业托管套件怎么用**、以及**把它铺给 10 万员工还差什么(诚实的成熟度评估)**。
> 配套:[`DEPLOYMENT.md`](DEPLOYMENT.md)(部署步骤)· [`PRIVATE_DEPLOYMENT.md`](PRIVATE_DEPLOYMENT.md)(私有化)·
> [`enterprise/DEPLOY.md`](enterprise/DEPLOY.md)(MDM 强制安装)· [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md)(安全逐条)· [`ARCHITECTURE.md`](ARCHITECTURE.md)。

---

## 1. 一句话:它是怎么"分版本"的

这是**一个** Chrome MV3 扩展、**一套代码、无后端**;所有操作都以**用户本人飞书身份**(OAuth `user_access_token`,**绝不**回退 tenant)进行。

所谓"版本"**不是分叉、不是不同代码库**,而是**构建期**由 `VITE_*` 环境变量(只从 `.env` 文件读)折叠进 `src/shared/config.ts` 的 `BUILD_CONFIG`,再派生出一组特性开关。**所有版本共享同一套硬安全边界**(见 [SECURITY_AUDIT](SECURITY_AUDIT.md))。关键设计:**每个企业特性都是 `flag && oauthProxyUrl` 双重门控**——没有代理的构建(商店版)会把企业相关网络代码**死代码消除**,即"商店版里查不到任何企业端点"。

## 2. 私有化 vs SaaS vs 企业托管(核心对比)

| 维度 | 商店版 / SaaS | 个人自分发 | 私有化(on-prem) | 企业托管 |
|---|---|---|---|---|
| 适合谁 | 个人 / 小团队,飞书公有云 | 小而可信的团队 | 自建(私有化)飞书 + 内网大模型 | 万人级、需集中管控 |
| 飞书域名 | `feishu.cn`(公有云) | `feishu.cn` | **自定义** `VITE_FEISHU_BASE_DOMAIN`(派生 `open./accounts./<tenant>.` 等) | SaaS 或私有化域名皆可 |
| 凭证(App Secret) | **用户自填**(BYO),设备加密存储,**包里零凭证** | 打进包:明文(`.crx` 须保密)或密码加密(`appSecretEnc`) | **服务端持有**(OAuth 代理),包里只有 App ID + 代理地址 | 同私有化;还可由代理**托管下发 App ID**(`app_config`,App ID 本就是公开的) |
| 大模型 | 用户自填 Key | 可预置 | 内网大模型,host 白名单锁死 | 可由代理**托管下发**(`llm_config`,Key 只给已验证的本租户成员、可仅存内存、可锁定) |
| OAuth 代理 | 无 | 无 | **推荐**(`oauth-proxy-server.mjs`,只换 token、不碰用户数据) | **必需**(同时挂载托管配置 / 技能库 / 云备份 / 管理台) |
| 出网 | 飞书 + 用户填的大模型 | 同左 | 锁内网即纯内网(`VITE_OPENAI_ALLOWED_HOSTS` + CSP) | 同私有化 |
| API 版本 | 跟随 SaaS | 跟随 SaaS | **自动回退** `/vN/`→`v(N-1)`(私有化 OpenAPI 常滞后;仅读、避免写重复) | 同私有化 |
| 集中策略 / 管控 | 无 | 无 | 可选 | **有**:中心策略(强制/锁定开关)、**fail-closed**、技能库、云备份、管理台 |
| 分发 | Chrome 应用店 | 自分发 `.crx` | 自托管 `.crx` + `update_manifest.xml` + MDM 强制安装(固定扩展 ID) | 同私有化(MDM/GPO) |

> **判定**:公有云 + 自带凭证 = **商店版**;自建飞书 / 内网大模型 = **私有化**;万人级 + 要统一下发配置/策略/审计 = **企业托管**(叠加在私有化或 SaaS 之上)。

构建期变量速查(全部见 [`.env.example`](../.env.example)):`VITE_FEISHU_BASE_DOMAIN`(域名→公有/私有)· `VITE_OAUTH_PROXY_URL`(有它才有"企业"特性)· `VITE_FEISHU_APP_SECRET[_ENC]`(明文/加密 secret)· `VITE_OPENAI_ALLOWED_HOSTS`(大模型 host 白名单,**设了 CSP 也锁死**)· `VITE_ALLOWED_CIDRS`(设备内网门,**仅 UX 提示**,见 §5)· `VITE_NO_REMOTE_CODE`(去 `unsafe-eval`,见 §4)· `VITE_WEBSTORE`(商店版,强制清空凭证/代理)。

## 3. 企业托管套件(可选 · 一个零依赖 Node 进程)

在"换 token 代理"上**同进程**挂载,全部 `HAS_* = 开关 && 有代理` 双门控:

- **托管 App ID/Secret**(`app_config`):员工免配置;Secret 只在服务端、可轮换。
- **托管大模型**(`llm_config`):Base URL/Key/模型只下发给**已验证的本租户成员**;`llmLockManaged`(锁定不可改)、`llmNoPersist`(Key 只存内存,绝不落客户端)。
- **中心策略**(`policy`):强制/锁定 `autoConfirm` 等;**fail-closed**——代理不可达时**默认不自动确认删除**(故障收紧而非放松安全)。
- **共享技能库**(`/skills/*`,`skill-proxy-server.mjs`):多用户**脱敏**经验汇聚 / 去重 / 打分 / 晋级 / 主动推送(**只传工具名 + 抽象意图,绝不传原始任务文本/数据**)。
- **企业云备份**(`/artifacts/*`,`artifact-proxy-server.mjs`):小程序/建站/PPT 镜像到**企业自有对象存储**,按 `open_id` 隔离、可选 AES-GCM。
- **运维管理台**(`/admin`,`admin-server.mjs` + `admin-ui.html`):看板 / 技能审核 / 备份管理 / 配置巡检 / 审计。

> 部署:[`oauth-proxy/`](oauth-proxy/)(Dockerfile + compose + nginx + README)。`docs/sim/validate-server.mjs` 用合成数据对这些端点做 29 条端到端断言(`npm run validate:server`,无需真飞书)。

## 4. 安全加固(默认 vs 加固姿态)

默认构建对个人友好,但要达到"零外泄"承诺,请显式加固:

- **大模型出网**:`assertSafeBaseUrl` 仅在 `VITE_OPENAI_ALLOWED_HOSTS` **非空**时强制 host 白名单;默认构建的 CSP `connect-src` 含通配 `https:`(为支持用户 BYO 任意 OpenAI 兼容端点)。**"无外泄"保证要求你 pin `VITE_OPENAI_ALLOWED_HOSTS`**(同时 CSP 收紧到飞书 + 你的大模型 origin)。
- **不执行远程代码**:LLM 生成的渲染代码默认经 `new Function` 在沙箱(opaque origin + `connect-src:'none'`)里跑,保留 `unsafe-eval`。**推荐企业/商店发布设 `VITE_NO_REMOTE_CODE=1`**——改用声明式 `VizSpec` 渲染,**包内零 `unsafe-eval`**(CI 用 `scripts/check-no-eval.mjs` 断言)。
- **商店/公开包零泄漏**:`scripts/check-store-bundle.mjs`(CI 内)断言商店包**不含任何企业端点串、不含任何 baked secret**——把"构建复核端点串为 0"从人工变成强制门禁。
- **凭证存储**:`chrome.storage` 内 AES-256-GCM(设备种子 PBKDF2);App Secret 三档:明文 / 密码加密(`appSecretEnc`) / 代理(不进包)。

## 5. 铺给 10 万员工:批量部署

- **强制安装**(不走应用店、不用开发者模式):自托管 `.crx` + [`enterprise/update_manifest.xml`](enterprise/update_manifest.xml) + Chrome 策略 `ExtensionInstallForcelist`;含现成 macOS [`.mobileconfig`](enterprise/feishu-ai-chrome-forceinstall.mobileconfig)。扩展 ID 由 `manifest.json` 的 `key` 固定。详见 [`enterprise/DEPLOY.md`](enterprise/DEPLOY.md)。
- **版本/更新**:`manifest.json`、`update_manifest.xml`、`package.json` 三处版本须一致(CI 已加漂移检查);升级时**保留上一版 `.crx`** 以便回滚,可按 OU 分批/灰度。
- **网络管控**:`VITE_ALLOWED_CIDRS` 的设备侧 WebRTC 检查**只是 UX 提示**,**真正的网络边界应放在代理侧**(IP 白名单 + 内网/VPN + 在 `/admin` 前置 SSO,如 oauth2-proxy / Authelia)。
- **CN 与海外**:一个构建只服务一个 `VITE_FEISHU_BASE_DOMAIN`;**飞书(CN)与 Lark(国际)需分别构建**。

## 6. 数据流与合规

- **核心扩展无后端、无遥测**:不做任何静默上报(见 [`PRIVACY.md`](../PRIVACY.md))。数据在用户浏览器 ↔ 飞书 ↔ 用户/企业选定的大模型之间流动。
- **企业托管会引入服务端组件**,采购/合规需评估其数据流:① OAuth 代理(只换 token,不碰用户业务数据);② 托管大模型中继(**企业大模型会看到发去的提示词内容**;`VITE_LLM_REDACT` 做 PII 脱敏 + 有 payload 上限,但脱敏非万能,需评估);③ 共享技能库(脱敏意图,非原始数据);④ 云备份(落到**企业自有**对象存储,可 AES-GCM)。
- **数据驻留**:私有化 + 内网大模型 + 企业自有存储 = 数据不出企业边界。CN(PIPL)/ 国际(GDPR)合规与 DPA 由部署方按上述数据流自评。

## 7. 成熟度评估(诚实:已就绪 vs 还差什么)

**结论**:代码与安全姿态已达较高企业标准;**一个有能力的平台团队今天就能私有化自部署**。要做到**万人级"开箱即用"**,以下是按优先级的真实差距(均为运维/工程成熟度,**非正确性缺陷**):

- ✅ **CI**(本次已补 `.github/workflows/ci.yml`):typecheck/test/validate/build + 商店包安全门 + 版本漂移检查,外部贡献者有反馈。
- ⬜ **原生托管策略**(Chrome `storage.managed` / `managed_schema`):目前集中配置走构建期变量或自建代理;大型组织希望用**同一套 MDM/GPO**(强制安装的那套)直接下发 域名/代理/App ID/大模型白名单/CIDR/autoConfirm 锁。**这是最该补的下一项。**
- ⬜ **审计可观测性**:管理台审计目前是 500 条内存环,**无持久化 / 无 SIEM 导出**,也无逐用户数据操作流水——大组织需回答"谁在何时批量改了哪个文档"。
- ⬜ **管理台鉴权**:单一共享口令,**无 RBAC / SSO**;万人级须在 `/admin` 前置 SSO 并把已认证身份带进审计。
- ⬜ **i18n**:UI 目前仅中文,无 i18n 框架。
- ⬜ **CN + 国际单构建**:目前需分别构建。

> 路线图欢迎参与,见 [`CONTRIBUTING.md`](../CONTRIBUTING.md)。
