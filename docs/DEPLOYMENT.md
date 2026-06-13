> 🌐 [English](DEPLOYMENT.en.md) | **中文**

# 部署指南 · 快速上手（企业 / 个人 / 私有化）

> 一页选好你的路 → 照抄命令 → 跑起来。深入细节链到对应文档：
> 安全模型 [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) · 代理 [`oauth-proxy/README.md`](oauth-proxy/README.md) ·
> 企业 MDM 强制安装 [`enterprise/DEPLOY.md`](enterprise/DEPLOY.md) · 使用手册 [`USER_GUIDE.md`](USER_GUIDE.md)

---

## 0. 选路（30 秒）

| 你是… | 推荐模式 | App Secret 在哪 | 跳到 |
|---|---|---|---|
| **个人 / 想最省事** | 纯 user-token（不内置凭据） | 没有 secret | [§2-A](#a-纯-user-token零内置最安全最省事) |
| **个人 / 小团队** | 直连·密码加密 | 加密进包，密码解锁 | [§2-B](#b-直连密码加密个人加固) |
| **企业（云端飞书）** | **代理模式 + MDM 强制安装** | 只在你的服务器 | [§3](#3-企业部署) |
| **私有化 / 纯内网** | 代理 + 私有域名 + 出站锁定 | 只在你的服务器 | [§4](#4-私有化--纯内网部署) |

> 三种模式的唯一区别就是 **App Secret 怎么处理**；其余构建/打包/飞书配套完全一样。

**所有模式的两个共同前提：**
1. **大模型 Key**：每个用户在扩展「⚙️设置」里自填（OpenAI 兼容，默认 DeepSeek）——**不是构建变量**。
2. **飞书后台一次性配套**：见 [§6](#6-飞书后台一次性配套开放平台--你的应用)（可用范围 / 重定向 URL / 权限 scope）。

---

## 1. 准备（所有模式通用）

```bash
git clone <repo> && cd feishu-ai-assistant
npm install
cp .env.example .env.local          # 已被 .gitignore；下面各模式只改其中几行
```
构建产物始终是 `dist/`，三种打包方式见 [§5](#5-打包方式)。

---

## 2. 个人部署

### A. 纯 user-token（零内置·最安全·最省事）
**不在包里放任何凭据**，用户在「设置」里粘贴自己的 `user_access_token`。`.env.local` 全留空，直接：
```bash
npm run build
```
加载 `dist/` 即可。适合自用 / 不想碰 App Secret 的人。

### B. 直连·密码加密（个人加固）
secret 加密进包，用户首次输一次解锁口令。**别用明文打包**。
```bash
# 1) 生成密文（按提示输入 secret + 口令）
node scripts/encrypt-secret.mjs
# 2) 填 .env.local：
#    VITE_FEISHU_APP_ID=cli_xxx
#    VITE_FEISHU_APP_SECRET_ENC=<上一步输出的密文>
#    VITE_FEISHU_APP_SECRET=        # 留空
npm run build
```
把统一**解锁口令**随安装说明发给用户（首次在「设置 → 飞书鉴权」解锁一次）。
> ⚠️ 纯明文 `VITE_FEISHU_APP_SECRET=` 仅用于本地联调，**别分发**——解包即得 secret。

---

## 3. 企业部署

目标：**secret 不进扩展包**（在你服务器上）+ 浏览器**强制安装**。

### 3.1 起 OAuth 代理（无需 Cloudflare）
```bash
cd docs/oauth-proxy
cp .env.example .env       # 填 FEISHU_APP_ID / FEISHU_APP_SECRET / ALLOW_ORIGIN / ALLOWED_REDIRECT_URIS
docker compose up -d --build      # 含 nginx；或裸 Node：见 oauth-proxy/README.md
curl http://你的代理域名/healthz   # → {"ok":true}
```
**只让员工能用**：把代理绑内网/仅 VPN 可达 + `IP_ALLOWLIST`，或在 nginx 前置企业 SSO（oauth2-proxy / Authelia）。原理与威胁模型见 SECURITY_AUDIT 的「★ App Secret 与 OAuth 安全模型」。

### 3.2 构建企业包（代理模式·无 secret）
`.env.local` 填：
```
VITE_FEISHU_APP_ID=cli_xxx
VITE_OAUTH_PROXY_URL=https://你的代理域名     # 生产用 https
# VITE_OAUTH_PROXY_KEY=<可选·共享防滥用密钥，对应代理 PROXY_SHARED_KEY>
# 三个 secret 变量全部留空！
```
```bash
npm run build
# 自检：包里有代理URL、【无】secret
grep -rl "你的代理域名" dist/ | head        # 应有
grep -r  "<你的AppSecret>" dist/ ; echo "↑ 应为空"   # 必须无输出
```

### 3.3 强制安装（不上架商店）
打 `.crx`（项目私钥已钉死扩展 ID）→ 托管到内网 HTTPS → 下发强制安装策略（Google 管理台 / Windows GPO / macOS MDM）。**完整步骤见** [`enterprise/DEPLOY.md`](enterprise/DEPLOY.md)。

### 3.4 企业统一下发大模型 + 安全选项（可选，让员工免填 key）

让**本企业飞书成员**授权后自动拿到公司大模型配置（key 不进扩展包），并可叠加安全管控。详见
[`oauth-proxy/README.md` §5](oauth-proxy/README.md)；最小步骤：

**① 代理 `.env`（在 §3.1 基础上加）：**
```bash
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=sk-...
LLM_MODEL=deepseek-chat
FEISHU_TENANT_KEY=你的企业租户key   # ★必填：不设则一律拒绝下发（fail-closed）。任一 user_info 响应里能看到 tenant_key
# 可选安全项：
# LLM_LIMIT_PER_HOUR=60            # 每用户每小时取配置上限
# POLICY_AUTO_CONFIRM=0           # 强制关闭“自动确认删除”并锁定
# POLICY_NOTICE=本工具受公司安全策略管控
```
**② 客户端构建 `.env.enterprise.local`（在 §3.2 基础上加）：**
```bash
VITE_LLM_FROM_PROXY=1            # 从代理取大模型配置
# VITE_LLM_LOCK_MANAGED=1        # 禁止员工切到“手动配置”
# VITE_LLM_NO_PERSIST=1          # 公司 key 仅内存不落盘
# VITE_LLM_REDACT=1              # 外发前脱敏（手机/邮箱/身份证）
# VITE_LLM_MAX_PAYLOAD_CHARS=20000
# VITE_ENTERPRISE_POLICY=1       # 启用统一策略下发
```
**③ 员工端**：装好后「设置 → 飞书授权」即可，**无需填 API Key**；设置里有「企业统一 / 手动」开关（除非锁定）。
安全模型 / 已知残留见 [`SECURITY_AUDIT.md` → ★ 企业托管 LLM](SECURITY_AUDIT.md)。

### 3.5 托管 App ID + 共享技能库 + 云备份 + 管理台（可选·同进程挂载）

代理进程会自动挂载这几个子服务，**按需用环境变量打开**，客户端再用对应 `VITE_*` 开关启用（双门控，商店版无代理 → 死代码消除）。完整变量见 **[`index.html` → 环境变量速查](index.html)** 与各 `.mjs` 文件头。

```bash
# 代理 .env 追加（按需）：
# —— 托管 App ID：单一企业构建只内置代理地址，App ID 由代理 app_config 下发（公开值，无需 token）
#    客户端加 VITE_APP_ID_FROM_PROXY=1，并把 VITE_FEISHU_APP_ID 留空
# —— 共享技能库（client: VITE_SKILLS_ENABLED=1）
EMBED_URL=https://api.openai.com/v1/embeddings   # 不配则内存假向量(语义弱)
EMBED_KEY=sk-...  EMBED_MODEL=text-embedding-3-small
SKILLS_FILE=/var/lib/feishu/skills.json          # 落盘；SKILLS_MAX 默认 20000 条上限
# —— 企业云备份（client: VITE_ARTIFACT_SYNC=1；需 FEISHU_TENANT_KEY 租户锁）
S3_ENDPOINT=...  S3_REGION=...  S3_BUCKET=...  S3_ACCESS_KEY=...  S3_SECRET_KEY=...   # 或 ARTIFACTS_DIR=本地盘
ARTIFACT_ENC_KEY=<32字节hex>                     # 可选·静态 AES-GCM
# —— 运维管理台（设了密码才挂载 /admin）
ADMIN_PASSWORD=<高熵密码>
ADMIN_TOKEN_SECRET=<32字节随机>                  # ★建议设：会话签名密钥与登录密码解耦
```
- **管理台安全**：`/admin` 已纳入 `IP_ALLOWLIST`（在所有子服务分发之前把关），并带防点击劫持头 + 同源校验 + 登录限流。务必**仅内网/VPN 可达**。浏览器开 `https://<你的代理>/admin` 登录。
- **一键复验**：`npm run validate:server` 用合成数据（假飞书 + spawn 真代理）跑 29 条端到端断言。

---

## 4. 私有化 / 纯内网部署

> 📖 私有化有**专用详解文档**（架构/前置/完整配置/代理/出站锁定/版本回退/网络限制/权限/凭据/分发/升级/验证/排错）：
> **[`PRIVATE_DEPLOYMENT.md`](PRIVATE_DEPLOYMENT.md)**。下面是速览。

在 §3（代理模式）基础上，再锁住域名与出站：
```
VITE_FEISHU_APP_ID=cli_xxx
VITE_OAUTH_PROXY_URL=https://代理.你的内网域
VITE_FEISHU_BASE_DOMAIN=your-domain        # 私有化飞书：所有 host 由它派生（open./accounts./<租户>.）
VITE_OPENAI_ALLOWED_HOSTS=llm.your-domain  # 锁死大模型 host → 去掉 https: 通配
# 可选：仅内网/VPN 可用
VITE_ALLOWED_CIDRS=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,100.64.0.0/10
```
```bash
npm run build
# 自检：CSP connect-src 只剩内网 host（无裸 https:）
python3 -c "import json;print(json.load(open('dist/manifest.json'))['content_security_policy']['extension_pages'])"
```
效果：扩展**只能**访问 `*.your-domain`（飞书）+ 钉死的大模型 host，**纯内网出站**。代理的 `FEISHU_API_BASE` 也改成 `https://open.your-domain/open-apis`。

### API 版本自动回退（私有化版落后于 SaaS 时）
私有化实例的 OpenAPI 版本常落后于 SaaS。本构建**不把版本写死**：设了 `VITE_FEISHU_BASE_DOMAIN`（即私有化）后，若某 `/<服务>/vN/...` 路径在旧实例上 **404**（该版本不存在），请求层会**自动降到 `v(N-1)` 逐级重试到 `v1`，并记住该服务实际可用的版本**，之后直达、不再来回试。
- 安全：HTTP 404 = 网关没匹配到路径 = 请求**根本没执行**，所以即便写操作降级重试也不会重复创建。
- SaaS 构建（默认 `feishu.cn`）不启用此逻辑（端点一定存在、零额外开销）。
- 实现：`src/shared/feishu/version.ts` + `http.ts feishuFetch`（覆盖 bitable / docx / sheets / drive / wiki 等所有数据 API；OAuth 换 token 不在此列，因其跨版本请求形态不同）。

---

## 5. 打包方式

> 🧰 **图形化向导（最省事）**：`npm run package:ui` 打开 `http://localhost:8799`（仅本机），网页上选模式、改名称/图标、勾参数 → **一键打包下载 `.zip`**。底层就是下面这些命令 + 后处理 `manifest`/图标，适合不想碰命令行的同学。

| 方式 | 命令 | 用途 |
|---|---|---|
| 图形化向导 | `npm run package:ui` | 小白友好：网页选模式/改名称图标/填参数 → 一键打包下载 |
| 未打包目录 | 加载 `dist/` | 个人 / 联调（`chrome://extensions` → 开发者模式 → 加载已解压） |
| zip | `cd dist && zip -qr ../pkg.zip .` | 分发 / 备份 |
| **.crx**（钉死 ID） | 见 [`enterprise/DEPLOY.md` §一](enterprise/DEPLOY.md) | 企业强制安装（需 `extension-key.pem`） |

> 🍴 **Fork / 二次分发必看**：`manifest.json` 里的 `key` 字段（公钥）钉死了**原作者的扩展 ID**
> `jhdbgegk…`。你 fork 后**必须换成自己的**——删掉 `key` 字段让 Chrome 自动分配，或用自己的
> `extension-key.pem`（`chrome --pack-extension` 会生成）重新签名；并把文档/`.env` 示例里的扩展 ID、
> 重定向 URL、`ALLOW_ORIGIN` 等占位都改成你自己的。否则会与原作者的 ID 冲突、且代理白名单会错放行原扩展。

---

## 6. 飞书后台一次性配套（开放平台 → 你的应用）

1. **可用范围**：加全员 / 部门 / 指定人 —— **决定谁能授权**。
2. **重定向 URL**（安全设置）：`https://jhdbgegkmhcopcilclkpioilclemkeog.chromiumapp.org/`（含末尾斜杠；私有化换成你扩展 ID 对应的）。
3. **权限 scope**（权限管理）：开 **`offline_access`（必须，否则 token 2 小时失效无法续期）** + 按需 `bitable:app` / `docx:document` / `sheets:spreadsheet` / `drive:drive` / `wiki:wiki` / `contact:user.base:readonly`，**且只勾「用户身份」**。
   - **不要**：`im` / `contact:contact` / `transfer_owner` / `permissions` / `admin`（代码也硬禁）。
   - 想**去掉删除权限**：多维表格用细粒度权限、不勾「删」；详见 SECURITY_AUDIT。
4. **发布应用**：创建版本 → 提交发布（否则只有测试成员能授权）。

---

## 7. 构建变量速查

| 变量 | 模式 | 说明 |
|---|---|---|
| `VITE_FEISHU_APP_ID` | 除"纯 user-token"外都要 | 飞书应用 ID |
| `VITE_FEISHU_APP_SECRET` | 个人·直连明文 | ⚠️ 进包明文，勿分发 |
| `VITE_FEISHU_APP_SECRET_ENC` | 个人·密码加密 | `encrypt-secret.mjs` 生成 |
| `VITE_OAUTH_PROXY_URL` | 企业 / 私有化 | secret 不进包 |
| `VITE_OAUTH_PROXY_KEY` | 可选 | 代理共享密钥（防滥用，非强密钥） |
| `VITE_FEISHU_BASE_DOMAIN` | 私有化 | 飞书基础域名，派生所有 host + CSP |
| `VITE_OPENAI_ALLOWED_HOSTS` | 私有化 / 锁出站 | 锁死大模型 host |
| `VITE_ALLOWED_CIDRS` | 可选 | 只在这些网段可用（内网/VPN） |
| `VITE_FEISHU_OAUTH_SCOPE` | 可选 | OAuth 申请的 scope（须与后台一致） |
| `VITE_MAX_TOOL_CALLS` | 可选 | agent 单轮工具上限（默认 30） |
| `VITE_CLIP_ENABLED` | 可选 | 网页剪藏开关（默认开，设 false 关闭） |

> Vite 只认 `.env` 文件里的 `VITE_*`（不读 `process.env`）。多套配置可用 `.env.<mode>.local` + `vite build --mode <mode>`。

---

## 8. 验证 & 排错

- **代理模式跑通的标志**：授权后代理日志出现 `[proxy] … grant=authorization_code status=200`，且**包里无 secret**。
- `redirect_uri_forbidden`：代理 `ALLOWED_REDIRECT_URIS` 和扩展实际回调不一致 → 按日志改。
- `invalid_grant`：授权码过期/复用，重新点授权。
- 403 权限错：飞书后台 scope 没开全 / 没勾用户身份 / 用户不在可用范围。
- 全屏「检查网络访问权限」：设了 `VITE_ALLOWED_CIDRS` 但检测不到内网 IP（现代 Chrome 的 mDNS 会让 WebRTC 取不到 LAN IP）——内网用户若被误锁，调整该项或改用网关层限制。