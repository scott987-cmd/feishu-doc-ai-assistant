# 私有化部署专用文档（企业 / 内网 / 私有化飞书）

> 面向**私有化飞书 + 内网大模型 + 受管浏览器**的企业场景，把所有私有化相关的内容一站讲透：
> 架构 → 前置条件 → 完整构建配置 → OAuth 代理 → 出站锁定 → API 版本回退 → 网络限制 →
> 权限最小化 → 凭据管理 → 分发强制安装 → 升级 → 端到端验证 → 排错。
>
> 通用部署（个人/企业云）见 [`DEPLOYMENT.md`](DEPLOYMENT.md)；强制安装细节见 [`enterprise/DEPLOY.md`](enterprise/DEPLOY.md)；
> 安全模型/图解见 [`../SECURITY_AUDIT.md`](../SECURITY_AUDIT.md)；代理见 [`oauth-proxy/README.md`](oauth-proxy/README.md)。

---

## 1. 私有化的本质：纯内网、无后端、出站只到两处

- 扩展**无自有后端**，运行时只做两类出站：**①私有化飞书**（`*.<你的域名>`）、**②你的内网大模型**。
- 这两处都可锁死到内网，配合受管浏览器，整套**不出公网**。
- 操作身份始终是**用户本人 `user_access_token`**（不用 tenant/app 身份）；App Secret 只用于 OAuth 换 token，且**代理模式下根本不进客户端**。

### 整体架构图

```
┌───────────────────────────── 公司内网 / 受控网络 ──────────────────────────────────┐
│                                                                                    │
│  受管浏览器（MDM/GPO 强制安装 .crx，ID 固定）                                          │
│  ┌──────────────────────────────────────────────────────┐                          │
│  │  飞书文档AI助手 · 扩展                                    │                          │
│  │   侧边栏(React)   后台 SW   内容脚本                       │                          │
│  │   沙箱 iframe〔运行 AI 生成代码, connect-src:'none'〕      │ ← 拿了数据也发不出去        │
│  └─────┬───────────────────────────────────┬────────────┘                          │
│        │ ① 飞书读写                          │ ② 大模型推理                            │
│        │   user_access_token（用户本人身份）   │   用户在「设置」自填 Key                  │
│        ▼                                    ▼                                       │
│  ┌──────────────────────┐             ┌────────────────────┐                       │
│  │ 私有化飞书             │             │ 内网大模型           │                       │
│  │  open.<域名>   (API)   │             │  llm.<域名>         │  OpenAI 兼容           │
│  │  accounts.<域名>(同意) │             │  (vLLM/Ollama/网关)  │                       │
│  │  <租户>.<域名> (页面)   │             └────────────────────┘                       │
│  └──────────┬───────────┘                                                          │
│             │ ③ 用 open.<域名> 换 token（代理注入 secret，客户端不带）                    │
│             ▼                                                                       │
│  ┌──────────────────────────────────────┐                                          │
│  │ OAuth 代理（持 App Secret，仅服务端）     │  绑内网 / 仅 VPN 可达                       │
│  │  oauth-proxy-server.mjs                │  + IP 白名单 + 可选前置企业 SSO              │
│  └──────────────────────────────────────┘                                          │
│                                                                                    │
│  ▣ 出站双重锁定：代码层 isFeishuOutboundAllowed + CSP connect-src                      │
│     connect-src 只列  *.<域名>  代理  llm.<域名>  —— 无裸 https:                        │
└────────────────────────────────────────────────────────────────────────────────┘
                         ╳ 不出公网：无自有后端、无第三方依赖、secret 不进包
```

要点：①②是仅有的两类出站，都锁在内网；③代理持 secret、客户端不带；沙箱 `connect-src:'none'` 与出站锁定相互独立。

---

## 2. 前置条件（清单）

| 项 | 说明 |
|---|---|
| 私有化飞书实例 | 有统一基础域名，如 `your-domain`；派生 `open.`/`accounts.`/`<租户>.` 子域 |
| 飞书自建应用 | App ID + Secret；可用范围/重定向/scope 配好（见 §8） |
| 内网大模型 | OpenAI 兼容接口（vLLM / Ollama / 自建网关均可），内网域名如 `llm.your-domain` |
| 内网 HTTPS 托管 | 放 `.crx` + `update_manifest.xml`（强制安装用） |
| OAuth 代理主机 | 内网一台机器跑 `oauth-proxy-server.mjs`（持 secret） |
| 受管浏览器 | Chrome/Edge + MDM/GPO 下发强制安装策略 |

---

## 3. 完整构建配置（私有化全套）

在仓库根目录写 `.env.local`（已 gitignore）。**一份可直接改的私有化模板：**

```bash
# —— 飞书应用 —— （代理模式：不注入 secret）
VITE_FEISHU_APP_ID=cli_xxx
VITE_OAUTH_PROXY_URL=https://feishu-proxy.your-domain        # 你的代理（https）
# VITE_OAUTH_PROXY_KEY=                                       # 可选·防滥用共享密钥

# —— 私有化飞书域名 —— （一处定，所有 host 派生）
VITE_FEISHU_BASE_DOMAIN=your-domain
# → open.your-domain（API）/ accounts.your-domain（OAuth 同意页）/ <租户>.your-domain（页面）

# —— 锁死大模型 host（纯内网出站的关键）——
VITE_OPENAI_ALLOWED_HOSTS=llm.your-domain                    # 多个用逗号；设了就去掉 https: 通配

# —— 可选：只在内网/VPN 可用 ——
VITE_ALLOWED_CIDRS=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,100.64.0.0/10

# —— OAuth scope（须与后台一致，只勾用户身份；offline_access 必须，否则 token 2h 失效）——
# VITE_FEISHU_OAUTH_SCOPE=offline_access bitable:app docx:document sheets:spreadsheet drive:drive wiki:wiki contact:user.base:readonly

# —— 可选：关网页剪藏 / 调 agent 工具上限 ——
# VITE_CLIP_ENABLED=false
# VITE_MAX_TOOL_CALLS=40

# —— secret 三件套全部留空（代理模式）——
VITE_FEISHU_APP_SECRET=
VITE_FEISHU_APP_SECRET_ENC=
```

构建并自检：
```bash
npm run build
# ① 出站只剩内网（无裸 https:）
python3 -c "import json;print(json.load(open('dist/manifest.json'))['content_security_policy']['extension_pages'])"
# 期望 connect-src 形如：'self' https://*.your-domain https://feishu-proxy.your-domain https://llm.your-domain
# ② 包里无 secret
grep -r "<你的AppSecret>" dist/ ; echo "↑ 应为空"
```

> 变量速查见 [`DEPLOYMENT.md §7`](DEPLOYMENT.md)。Vite 只认 `.env` 文件里的 `VITE_*`（不读 `process.env`）。

---

## 4. OAuth 代理（私有化要点）

代理本体 [`oauth-proxy-server.mjs`](oauth-proxy-server.mjs)，零依赖 Node。私有化关键：

```bash
# docs/oauth-proxy/.env
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx                                  # 只在服务端，绝不进包
FEISHU_API_BASE=https://open.your-domain/open-apis      # ★ 私有化：指向你的内网飞书
ALLOW_ORIGIN=chrome-extension://<你的扩展ID>
ALLOWED_REDIRECT_URIS=https://<你的扩展ID>.chromiumapp.org/
IP_ALLOWLIST=10.0.0.0/8,172.16.0.0/12                   # ★ 强控制：只放公司内网/出口
# PROXY_SHARED_KEY=一串长随机                            # 可选，对应 VITE_OAUTH_PROXY_KEY
RATE_LIMIT_PER_MIN=60
```
- **"谁能调代理 = 谁是公司员工"**：把代理绑内网/仅 VPN 可达 + `IP_ALLOWLIST`；更强是在 nginx 前置企业 SSO（oauth2-proxy / Authelia）。详见 [`oauth-proxy/README.md`](oauth-proxy/README.md) 与 [`oauth-proxy/nginx.conf`](oauth-proxy/nginx.conf)。
- Docker：`cd docs/oauth-proxy && docker compose up -d --build`；systemd 示例见 `oauth-proxy-server.mjs` 末尾。
- 代理只换 token、**不经手任何用户数据**；为什么安全见 SECURITY_AUDIT 的「★ App Secret 与 OAuth 安全模型」图解。

---

## 5. 出站锁定 & 纯内网验证

私有化构建后，扩展**只能**访问两类 host，双重锁定：
- **代码层**：`isFeishuOutboundAllowed` 只放行 `*.<域名>` 子域 + 代理 host；大模型由 `assertSafeBaseUrl` 限制在 `VITE_OPENAI_ALLOWED_HOSTS`。
- **CSP 层**：`connect-src` 只列 `https://*.<域名>`、代理 host、钉死的大模型 host —— **没有裸 `https:` 通配**。

浏览器需能访问的 host：`open.<域名>`（API）、`accounts.<域名>`（OAuth 同意页弹窗）、`<租户>.<域名>`（文档页本身）、代理 host、`llm.<域名>`。确保内网 DNS/网关都通。

> 沙箱（数据可视化/PPT/网站/看板）运行 LLM 生成代码，**`connect-src 'none'`**：拿了数据也发不出去，与出站锁定独立。

---

## 6. API 版本自动回退（私有化版落后于 SaaS）

私有化实例的 OpenAPI 版本常落后。本构建**不写死版本**：设了 `VITE_FEISHU_BASE_DOMAIN`（即私有化）后，若 `/<服务>/vN/...` 在旧实例 **404**，请求层自动降到 `v(N-1)` 逐级到 `v1`，并**记住可用版本**，之后直达。
- 安全：404 = 网关没匹配到路径 = 请求**未执行**，写操作降级也不会重复创建。
- 覆盖 bitable / docx / sheets / drive / wiki 等所有数据 API；OAuth 换 token 不在此列（跨版本形态不同）。
- 实现：`src/shared/feishu/version.ts` + `http.ts feishuFetch`；测试 `version.test.ts` / `http.version.test.ts`。

---

## 7. 网络访问限制（可选，CIDR）

设 `VITE_ALLOWED_CIDRS` 后，浏览器检测到的本机 IP 不在网段内则**锁定扩展**（只在内网/VPN 可用）。
> ⚠️ 现代 Chrome 默认用 mDNS 混淆 WebRTC 候选，可能取不到 LAN IP → 检测为空。若内网用户被误锁，**优先用网关层（IP/SSO）限制，而非此项**；或评估后再启用。

---

## 8. 权限最小化（飞书后台一次性）

- **可用范围**：加员工/部门（决定谁能授权）。
- **重定向 URL**：`https://<你的扩展ID>.chromiumapp.org/`（含末尾斜杠）。
- **scope**：开 **`offline_access`（必须，否则 token 约 2h 失效无法续期，报 99991677）** + 按需 `bitable:app`/`docx:document`/`sheets:spreadsheet`/`drive:drive`/`wiki:wiki`/`contact:user.base:readonly`，**且只勾「用户身份」、不勾「应用身份」**——这样即便 secret 泄露，tenant token 也读写不了数据。
- **不要**：`im` / `contact:contact` / `transfer_owner` / `permissions` / `admin`（代码也硬禁）。
- **去删除权限**：多维表格用细粒度权限、不勾「删」；详见 SECURITY_AUDIT。代码层亦硬禁文件级删除、内容删除需确认。

---

## 9. 凭据与 secret 管理

- **App Secret**：代理模式下**不进包**；只存在代理服务端（systemd `Environment=` / Docker secret / K8s Secret）。
- **轮换**：怀疑泄露或定期 → 飞书后台重置 Secret → 改代理里的值（扩展无需重打，因为它不带 secret）。
- **大模型 Key**：每个用户在「设置」自填（不进构建）。
- **仓库卫生**：`feishu-app-config.txt` / `.env*` / `*.pem` 已 `.gitignore`，绝不提交、用完即删。

---

## 10. 分发与强制安装

私有化不上架商店：打 `.crx`（项目私钥钉死扩展 ID）→ 内网 HTTPS 托管 `.crx` + `update_manifest.xml` → 下发强制安装策略（Google 管理台 / Windows GPO / macOS MDM，含现成 `.mobileconfig`）。**完整步骤见** [`enterprise/DEPLOY.md`](enterprise/DEPLOY.md)。

---

## 11. 内网大模型（OpenAI 兼容）

- 任意 OpenAI 兼容服务即可（vLLM / Ollama / 自建网关）。用户在「设置」填 **Base URL + Key + 模型**。
- Base URL **必须落在 `VITE_OPENAI_ALLOWED_HOSTS`** 内，否则被 `assertSafeBaseUrl` 拒绝（这正是纯内网的保证）。
- 视觉能力（截图识别）需要支持视觉的模型。

---

## 12. 升级流程

1. 改代码/配置 → `npm run build`（manifest `version` +1）。
2. 重打 `.crx`（**同私钥**）→ 覆盖内网 `.crx`。
3. 改 `update_manifest.xml` 的 `version` → 覆盖。
4. 受管浏览器几小时内（或重启）自动更新；急用让用户在 `chrome://extensions` 点「立即更新」。
5. 代理/飞书后台一般无需动；换 secret 时只改代理环境变量。

---

## 13. 端到端验证清单

- [ ] `dist/manifest.json` 的 `connect-src` 只含内网 host（无裸 `https:`）。
- [ ] `grep -r <AppSecret> dist/` 为空（包里无 secret）。
- [ ] 代理 `curl https://feishu-proxy.your-domain/healthz` → `{"ok":true}`。
- [ ] 浏览器能解析/访问 `open./accounts./<租户>.your-domain`、代理、`llm.your-domain`。
- [ ] 飞书后台：可用范围含测试人、重定向 URL 正确、scope 只勾用户身份。
- [ ] 加载扩展 → 设置 → 飞书授权 → 同意 → **代理日志出现 `grant=authorization_code status=200`**。
- [ ] 跑一个功能（建表/总结/生成 PPT）成功；若调到旧版本端点，日志/行为显示自动回退到可用版本。
- [ ] （如启用 CIDR）内网可用、断网/换网段被锁。

---

## 14. 排错

| 现象 | 排查 |
|---|---|
| OAuth 401/403 / 同意页打不开 | 重定向 URL、可用范围、scope 未配齐；`accounts.<域名>` 不可达 |
| 代理 `redirect_uri_forbidden` | 代理 `ALLOWED_REDIRECT_URIS` 与扩展实际回调不一致（看代理日志） |
| 代理 `invalid_grant` | 授权码过期/复用，重新点授权 |
| 某操作 404 但能力本应支持 | 私有化版落后；已自动回退（§6），若仍失败可能该端点在私有版根本未上线 |
| 大模型请求被拒 | Base URL 不在 `VITE_OPENAI_ALLOWED_HOSTS` 内 |
| 全屏「检查网络访问权限」| `VITE_ALLOWED_CIDRS` + WebRTC 取不到 LAN IP（§7），改用网关限制 |
| 403 无编辑权限 | 该资源非本人/未共享给应用；以本人身份操作或在文档「分享」加协作者 |

---

## 15. 安全模型

逐条审计、攻击场景、App Secret/OAuth 图解、出站锁定（M7）、沙箱隔离（M9）等：见 [`../SECURITY_AUDIT.md`](../SECURITY_AUDIT.md)。一句话：**纯内网、用户身份、secret 不进包、出站双重锁定、生成代码沙箱无网络。**
