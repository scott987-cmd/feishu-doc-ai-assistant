> 🌐 [English](README.en.md) | **中文**

# 飞书 OAuth 代理（自托管，无需 Cloudflare）

让 **App Secret 只留服务端**、扩展包里一字节都不带。客户端只发授权材料（code / refresh_token），
代理在服务端注入 secret 换 token，并把「该用户自己的 token」原样回传。

> 安全模型 / 流程图 / 威胁矩阵见 [`../SECURITY_AUDIT.md` → ★ App Secret 与 OAuth 安全模型](../SECURITY_AUDIT.md)。
> 代理本体：[`../oauth-proxy-server.mjs`](../oauth-proxy-server.mjs)（零依赖 Node ≥18）。

---

## 1. 起一个本地代理

### A. Docker（含 nginx，最贴近企业部署）
```bash
cd docs/oauth-proxy
cp .env.example .env          # 填 FEISHU_APP_ID / FEISHU_APP_SECRET / ALLOW_ORIGIN / ALLOWED_REDIRECT_URIS
docker compose up -d --build
curl http://localhost:8787/healthz     # → {"ok":true}
```
链路：`扩展 → localhost:8787 (nginx) → oauth-proxy:8787 → 飞书`。

### B. 裸 Node（最快，调试用）
```bash
FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=xxx \
ALLOW_ORIGIN=chrome-extension://jhdbgegkmhcopcilclkpioilclemkeog \
ALLOWED_REDIRECT_URIS=https://jhdbgegkmhcopcilclkpioilclemkeog.chromiumapp.org/ \
node docs/oauth-proxy-server.mjs
```

各项闸门（自测）：`/healthz` 200；错误 Origin→403；非法 grant→400；非法 redirect→400。

## 2. 企业级"只让员工能用"（无 Cloudflare）

代理只兜底防滥用，"谁能调"交给内网 + 身份网关：

- **强**：把服务只绑内网 / 仅 VPN 可达，并设 `IP_ALLOWLIST=公司出口网段`；
- **更强**：在 `nginx.conf` 前置 SSO（oauth2-proxy / Authelia / 你司零信任），员工登录才放行；
- **附加**：`PROXY_SHARED_KEY` + 扩展 `VITE_OAUTH_PROXY_KEY`（防随手滥用，非强密钥）。

生产把 nginx 的 `80` 换 `443` + 证书。多实例时把代理里的内存限流换成 Redis。

## 3. 配套构建「企业版扩展包」（代理模式 · secret 不进包）

用 proxy 模式构建（不注入 secret）：
```bash
# 在仓库根目录，写一个 .env.enterprise.local（已被 .gitignore）：
#   VITE_FEISHU_APP_ID=cli_xxx
#   VITE_OAUTH_PROXY_URL=http://localhost:8787      # 生产换成你的 https 代理域名
#   VITE_FEISHU_APP_SECRET=                          # 留空！
#   VITE_FEISHU_APP_SECRET_ENC=                      # 留空！
#   VITE_OAUTH_PROXY_KEY=                            # 如启用共享密钥就填
npx vite build --mode enterprise
# 校验：dist 里有代理 URL、没有 secret
```
然后 `chrome://extensions` → 开发者模式 → 加载 `dist/`（或分发 dist 的 zip / 重打 .crx）。

## 4. 飞书后台一次性配套

- **可用范围**：把测试人/全员加进去（决定谁能授权）。
- **重定向 URL**：加 `https://jhdbgegkmhcopcilclkpioilclemkeog.chromiumapp.org/`（含末尾斜杠）。
- **权限 scope**：只勾「用户身份」，删掉 `im`/`contact:contact`/`transfer_owner`/`permissions`/`admin`。

## 5. 企业安全选项（都经代理、仅本企业成员可得）

代理对 `llm_config` / `policy` 都用**用户自己的 user_access_token** 向飞书 `user_info` 校验，并核对
**`tenant_key == FEISHU_TENANT_KEY`** 才放行——公司 LLM key / 策略只下发给本企业成员。

| 能力 | 代理 env | 客户端构建 |
|---|---|---|
| 统一下发 LLM 配置 | `LLM_BASE_URL` `LLM_API_KEY` `LLM_MODEL` `FEISHU_TENANT_KEY` | `VITE_LLM_FROM_PROXY=1` |
| 锁定（禁手动配） | — | `VITE_LLM_LOCK_MANAGED=1` |
| LLM key 仅内存不落盘 | — | `VITE_LLM_NO_PERSIST=1` |
| 每用户取配置限流 | `LLM_LIMIT_PER_HOUR=60` | — |
| 统一策略 + 锁开关 | `POLICY_AUTO_CONFIRM` `POLICY_LEARN` `POLICY_NOTICE` | `VITE_ENTERPRISE_POLICY=1` |
| 外发脱敏 + 上限 | — | `VITE_LLM_REDACT=1` `VITE_LLM_MAX_PAYLOAD_CHARS=20000` |

- 用户在「设置」有「企业统一 / 手动」开关（`VITE_LLM_LOCK_MANAGED` 可锁死为仅企业）。
- 代理输出结构化**审计日志**：`[audit] <时间> ip=… action=llm_config|policy user=<open_id> status=…`（不含任何 token/内容）。
- ✅ 不设 `FEISHU_TENANT_KEY` 时**默认拒绝**下发（fail-closed）——必须设置才会启用 `llm_config`/`policy`。
- ⚠️ 残留风险：`tenant_key` 校验能挡住**跨租户**，但同租户内**另一飞书 app 的 user token** 也会通过（属内部成员场景，本就有合法访问权）。若要彻底绑定到本 app / 让 key 永不下发客户端，需改成 **LLM 网关模式**（LLM 调用也经代理、按调用计量）——更彻底，作为后续。