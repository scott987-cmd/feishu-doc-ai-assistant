> 🌐 **English** | [中文](DEPLOYMENT.md)

# Deployment Guide · Quick Start (Enterprise / Personal / Private)

> Pick your path on one page → copy the commands → get it running. Deep-dive details link to the relevant docs:
> Security model [`SECURITY_AUDIT.en.md`](SECURITY_AUDIT.en.md) · Proxy [`oauth-proxy/README.en.md`](oauth-proxy/README.en.md) ·
> Enterprise MDM forced install [`enterprise/DEPLOY.en.md`](enterprise/DEPLOY.en.md) · User guide [`USER_GUIDE.en.md`](USER_GUIDE.en.md)

---

## 0. Pick Your Path (30 seconds)

| You are… | Recommended mode | Where the App Secret lives | Jump to |
|---|---|---|---|
| **Personal / want the least hassle** | Pure user-token (no embedded credentials) | No secret | [§2-A](#a-pure-user-token-zero-embedded--most-secure--least-hassle) |
| **Personal / small team** | Direct connect · password-encrypted | Encrypted into the package, unlocked by password | [§2-B](#b-direct-connect--password-encrypted-personal-hardening) |
| **Enterprise (cloud Feishu)** | **Proxy mode + MDM forced install** | Only on your server | [§3](#3-enterprise-deployment) |
| **Private / pure intranet** | Proxy + private domain + outbound lockdown | Only on your server | [§4](#4-private--pure-intranet-deployment) |

> The only difference among the three modes is **how the App Secret is handled**; everything else — build/packaging/Feishu setup — is identical.

**Two common prerequisites for all modes:**
1. **LLM Key**: Each user fills it in themselves under the extension's "⚙️ Settings" (OpenAI-compatible, DeepSeek by default) — **not a build variable**.
2. **One-time Feishu console setup**: See [§6](#6-one-time-feishu-console-setup-open-platform--your-app) (availability scope / redirect URL / permission scopes).

---

## 1. Preparation (common to all modes)

```bash
git clone <repo> && cd feishu-ai-assistant
npm install
cp .env.example .env.local          # 已被 .gitignore；下面各模式只改其中几行
```
The build output is always `dist/`. See the three packaging methods in [§5](#5-packaging-methods).

---

## 2. Personal Deployment

### A. Pure user-token (zero embedded · most secure · least hassle)
**Don't put any credentials in the package.** Users paste their own `user_access_token` under "Settings". Leave `.env.local` entirely empty and just run:
```bash
npm run build
```
Load `dist/` and you're done. Suitable for self-use / people who don't want to deal with the App Secret.

### B. Direct connect · password-encrypted (personal hardening)
The secret is encrypted into the package; the user enters an unlock passphrase once on first use. **Don't bundle it in plaintext.**
```bash
# 1) 生成密文（按提示输入 secret + 口令）
node scripts/encrypt-secret.mjs
# 2) 填 .env.local：
#    VITE_FEISHU_APP_ID=cli_xxx
#    VITE_FEISHU_APP_SECRET_ENC=<上一步输出的密文>
#    VITE_FEISHU_APP_SECRET=        # 留空
npm run build
```
Send the unified **unlock passphrase** to users along with the install instructions (they unlock once under "Settings → Feishu Auth" on first use).
> ⚠️ Plaintext `VITE_FEISHU_APP_SECRET=` is for local debugging only. **Don't distribute it** — unpacking the build reveals the secret.

---

## 3. Enterprise Deployment

Goal: **secret stays out of the extension package** (it lives on your server) + browser **forced install**.

### 3.1 Start the OAuth proxy (no Cloudflare needed)
```bash
cd docs/oauth-proxy
cp .env.example .env       # 填 FEISHU_APP_ID / FEISHU_APP_SECRET / ALLOW_ORIGIN / ALLOWED_REDIRECT_URIS
docker compose up -d --build      # 含 nginx；或裸 Node：见 oauth-proxy/README.md
curl http://你的代理域名/healthz   # → {"ok":true}
```
**Restrict it to employees only**: bind the proxy to the intranet / make it VPN-reachable only + `IP_ALLOWLIST`, or front nginx with enterprise SSO (oauth2-proxy / Authelia). For the rationale and threat model, see "★ App Secret and OAuth Security Model" in SECURITY_AUDIT.

### 3.2 Build the enterprise package (proxy mode · no secret)
Fill `.env.local`:
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

### 3.3 Forced install (not listed on the store)
Build a `.crx` (the project private key locks the extension ID) → host it on intranet HTTPS → push a forced-install policy (Google Admin Console / Windows GPO / macOS MDM). **For the full steps, see** [`enterprise/DEPLOY.en.md`](enterprise/DEPLOY.en.md).

### 3.4 Enterprise-wide LLM provisioning + security options (optional, so employees don't fill in a key)

Let **members of this enterprise's Feishu** automatically receive the company's LLM configuration after authorization (the key never enters the extension package), with security controls layered on top. For details see
[`oauth-proxy/README.en.md` §5](oauth-proxy/README.en.md); minimal steps:

**① Proxy `.env` (add on top of §3.1):**
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
**② Client build `.env.enterprise.local` (add on top of §3.2):**
```bash
VITE_LLM_FROM_PROXY=1            # 从代理取大模型配置
# VITE_LLM_LOCK_MANAGED=1        # 禁止员工切到“手动配置”
# VITE_LLM_NO_PERSIST=1          # 公司 key 仅内存不落盘
# VITE_LLM_REDACT=1              # 外发前脱敏（手机/邮箱/身份证）
# VITE_LLM_MAX_PAYLOAD_CHARS=20000
# VITE_ENTERPRISE_POLICY=1       # 启用统一策略下发
```
**③ Employee side**: after installing, just go to "Settings → Feishu Authorization" — **no need to fill in an API Key**; Settings has an "Enterprise unified / Manual" toggle (unless locked).
For the security model / known residual risks, see [`SECURITY_AUDIT.en.md` → ★ Enterprise-Managed LLM](SECURITY_AUDIT.en.md).

---

## 4. Private / Pure Intranet Deployment

> 📖 Private deployment has a **dedicated detailed doc** (architecture / prerequisites / full configuration / proxy / outbound lockdown / version rollback / network restrictions / permissions / credentials / distribution / upgrade / verification / troubleshooting):
> **[`PRIVATE_DEPLOYMENT.en.md`](PRIVATE_DEPLOYMENT.en.md)**. Below is a quick overview.

On top of §3 (proxy mode), additionally lock down the domain and outbound traffic:
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
Result: the extension can **only** reach `*.your-domain` (Feishu) + the pinned LLM host — **pure intranet outbound**. Also change the proxy's `FEISHU_API_BASE` to `https://open.your-domain/open-apis`.

### Automatic API version fallback (when the private build lags behind SaaS)
A private instance's OpenAPI version often lags behind SaaS. This build **does not hardcode the version**: once `VITE_FEISHU_BASE_DOMAIN` is set (i.e., private deployment), if some `/<service>/vN/...` path returns **404** on the older instance (that version doesn't exist), the request layer **automatically downgrades to `v(N-1)`, retrying step by step down to `v1`, and remembers the version actually available for that service** — afterward it goes there directly without trial-and-error.
- Safety: HTTP 404 = the gateway matched no path = the request **was never executed**, so even a downgraded retry of a write operation won't create duplicates.
- SaaS builds (default `feishu.cn`) don't enable this logic (the endpoint is guaranteed to exist, zero extra overhead).
- Implementation: `src/shared/feishu/version.ts` + `http.ts feishuFetch` (covers bitable / docx / sheets / drive / wiki and all other data APIs; the OAuth token exchange is not included, since its request shape differs across versions).

---

## 5. Packaging Methods

| Method | Command | Use case |
|---|---|---|
| Unpacked directory | Load `dist/` | Personal / debugging (`chrome://extensions` → Developer mode → Load unpacked) |
| zip | `cd dist && zip -qr ../pkg.zip .` | Distribution / backup |
| **.crx** (pinned ID) | See [`enterprise/DEPLOY.en.md` §1](enterprise/DEPLOY.en.md) | Enterprise forced install (requires `extension-key.pem`) |

> 🍴 **Must-read for forks / redistribution**: the `key` field (public key) in `manifest.json` pins the **original author's extension ID**
> `jhdbgegk…`. After forking you **must replace it with your own** — either delete the `key` field to let Chrome auto-assign one, or use your own
> `extension-key.pem` (`chrome --pack-extension` generates one) to re-sign; and change the extension ID, redirect URL, `ALLOW_ORIGIN`, etc. placeholders in the docs / `.env` examples to your own. Otherwise you'll collide with the original author's ID, and the proxy allowlist will wrongly permit the original extension.

---

## 6. One-Time Feishu Console Setup (Open Platform → your app)

1. **Availability scope**: add everyone / departments / specific people — **this decides who can authorize**.
2. **Redirect URL** (security settings): `https://jhdbgegkmhcopcilclkpioilclemkeog.chromiumapp.org/` (include the trailing slash; for private deployment, use the one matching your extension ID).
3. **Permission scopes** (permission management): enable **`offline_access` (required, otherwise the token expires in 2 hours and can't be renewed)** + as needed `bitable:app` / `docx:document` / `sheets:spreadsheet` / `drive:drive` / `wiki:wiki` / `contact:user.base:readonly`, **and check only "user identity"**.
   - **Don't**: `im` / `contact:contact` / `transfer_owner` / `permissions` / `admin` (the code also hard-blocks these).
   - To **remove delete permissions**: use fine-grained permissions on the Base and don't check "delete"; see SECURITY_AUDIT for details.
4. **Publish the app**: create a version → submit for release (otherwise only test members can authorize).

---

## 7. Build Variables Cheat Sheet

| Variable | Mode | Description |
|---|---|---|
| `VITE_FEISHU_APP_ID` | Required for all except "pure user-token" | Feishu app ID |
| `VITE_FEISHU_APP_SECRET` | Personal · direct plaintext | ⚠️ Plaintext in the package, don't distribute |
| `VITE_FEISHU_APP_SECRET_ENC` | Personal · password-encrypted | Generated by `encrypt-secret.mjs` |
| `VITE_OAUTH_PROXY_URL` | Enterprise / private | Secret stays out of the package |
| `VITE_OAUTH_PROXY_KEY` | Optional | Proxy shared key (anti-abuse, not a strong key) |
| `VITE_FEISHU_BASE_DOMAIN` | Private | Feishu base domain, derives all hosts + CSP |
| `VITE_OPENAI_ALLOWED_HOSTS` | Private / outbound lockdown | Pins the LLM host |
| `VITE_ALLOWED_CIDRS` | Optional | Available only on these subnets (intranet/VPN) |
| `VITE_FEISHU_OAUTH_SCOPE` | Optional | OAuth requested scopes (must match the console) |
| `VITE_MAX_TOOL_CALLS` | Optional | Per-round agent tool-call limit (default 30) |
| `VITE_CLIP_ENABLED` | Optional | Web clipper toggle (on by default, set false to disable) |

> Vite only recognizes `VITE_*` in `.env` files (it doesn't read `process.env`). For multiple config sets, use `.env.<mode>.local` + `vite build --mode <mode>`.

---

## 8. Verification & Troubleshooting

- **Sign that proxy mode is working**: after authorization, the proxy log shows `[proxy] … grant=authorization_code status=200`, and **the package has no secret**.
- `redirect_uri_forbidden`: the proxy's `ALLOWED_REDIRECT_URIS` doesn't match the extension's actual callback → fix it per the log.
- `invalid_grant`: the authorization code expired/was reused, click authorize again.
- 403 permission error: the Feishu console scopes aren't fully enabled / "user identity" not checked / the user is outside the availability scope.
- Full-screen "Checking network access permission": `VITE_ALLOWED_CIDRS` is set but the intranet IP can't be detected (modern Chrome's mDNS prevents WebRTC from obtaining the LAN IP) — if intranet users get wrongly locked out, adjust this option or use gateway-level restrictions instead.
