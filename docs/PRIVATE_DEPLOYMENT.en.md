> 🌐 **English** | [中文](PRIVATE_DEPLOYMENT.md)

# Private Deployment Guide (Enterprise / Intranet / Self-hosted Feishu)

> For enterprise scenarios with **self-hosted Feishu + intranet LLM + managed browsers**, this document covers everything related to private deployment in one place:
> architecture → prerequisites → full build configuration → OAuth proxy → outbound lockdown → API version fallback → network restrictions →
> least-privilege permissions → credential management → forced-install distribution → upgrades → end-to-end verification → troubleshooting.
>
> For general deployment (personal / enterprise cloud) see [`DEPLOYMENT.en.md`](DEPLOYMENT.en.md); for forced-install details see [`enterprise/DEPLOY.en.md`](enterprise/DEPLOY.en.md);
> for the security model / diagrams see [`SECURITY_AUDIT.en.md`](SECURITY_AUDIT.en.md); for the proxy see [`oauth-proxy/README.en.md`](oauth-proxy/README.en.md).

---

## 1. The essence of private deployment: pure intranet, no backend, outbound to only two destinations

- The extension **has no backend of its own**. At runtime it makes only two kinds of outbound calls: **① self-hosted Feishu** (`*.<your-domain>`), and **② your intranet LLM**.
- Both can be locked down to the intranet. Combined with managed browsers, the whole stack **never leaves the corporate network**.
- The operating identity is always **the user's own `user_access_token`** (no tenant/app identity). The App Secret is used only to exchange OAuth tokens, and **in proxy mode it never reaches the client at all**.

### Overall architecture diagram

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

Key points: ① and ② are the only two kinds of outbound calls, both locked to the intranet; ③ the proxy holds the secret while the client never carries it; the sandbox's `connect-src:'none'` and the outbound lockdown are independent of each other.

---

## 2. Prerequisites (checklist)

| Item | Description |
|---|---|
| Self-hosted Feishu instance | Has a unified base domain, e.g. `your-domain`; derives the `open.`/`accounts.`/`<tenant>.` subdomains |
| Feishu custom app | App ID + Secret; availability scope / redirect / scope configured (see §8) |
| Intranet LLM | OpenAI-compatible interface (vLLM / Ollama / self-built gateway all work), intranet domain like `llm.your-domain` |
| Intranet HTTPS hosting | Hosts `.crx` + `update_manifest.xml` (for forced install) |
| OAuth proxy host | One intranet machine running `oauth-proxy-server.mjs` (holds the secret) |
| Managed browsers | Chrome/Edge + forced-install policy pushed via MDM/GPO |

---

## 3. Full build configuration (complete private-deployment set)

Create `.env.local` in the repo root (already gitignored). **A private-deployment template you can edit directly:**

```bash
# —— Feishu app —— (proxy mode: no secret injected)
VITE_FEISHU_APP_ID=cli_xxx
VITE_OAUTH_PROXY_URL=https://feishu-proxy.your-domain        # your proxy (https)
# VITE_OAUTH_PROXY_KEY=                                       # optional · shared key against abuse

# —— Self-hosted Feishu domain —— (set once, all hosts are derived)
VITE_FEISHU_BASE_DOMAIN=your-domain
# → open.your-domain (API) / accounts.your-domain (OAuth consent page) / <tenant>.your-domain (pages)

# —— Lock down the LLM host (the key to pure-intranet outbound) ——
VITE_OPENAI_ALLOWED_HOSTS=llm.your-domain                    # comma-separate multiple; setting this removes the https: wildcard

# —— Optional: usable only on intranet/VPN ——
VITE_ALLOWED_CIDRS=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,100.64.0.0/10

# —— OAuth scope (must match the backend; only grant user identity; offline_access is required, otherwise the token expires in 2h) ——
# VITE_FEISHU_OAUTH_SCOPE=offline_access bitable:app docx:document sheets:spreadsheet drive:drive wiki:wiki contact:user.base:readonly

# —— Optional: disable web clipping / tune the agent tool-call limit ——
# VITE_CLIP_ENABLED=false
# VITE_MAX_TOOL_CALLS=40

# —— Leave the secret trio all empty (proxy mode) ——
VITE_FEISHU_APP_SECRET=
VITE_FEISHU_APP_SECRET_ENC=
```

Build and self-check:
```bash
npm run build
# ① Outbound is intranet-only (no bare https:)
python3 -c "import json;print(json.load(open('dist/manifest.json'))['content_security_policy']['extension_pages'])"
# Expect connect-src like: 'self' https://*.your-domain https://feishu-proxy.your-domain https://llm.your-domain
# ② No secret in the bundle
grep -r "<your-app-secret>" dist/ ; echo "↑ should be empty"
```

> For a variable quick reference see [`DEPLOYMENT.en.md §7`](DEPLOYMENT.en.md). Vite only reads `VITE_*` from `.env` files (it does not read `process.env`).

---

## 4. OAuth proxy (private-deployment essentials)

The proxy itself is [`oauth-proxy-server.mjs`](oauth-proxy-server.mjs), a zero-dependency Node script. The keys for private deployment:

```bash
# docs/oauth-proxy/.env
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx                                  # server-side only, never enters the bundle
FEISHU_API_BASE=https://open.your-domain/open-apis      # ★ Private deployment: point to your intranet Feishu
ALLOW_ORIGIN=chrome-extension://<your-extension-ID>
ALLOWED_REDIRECT_URIS=https://<your-extension-ID>.chromiumapp.org/
IP_ALLOWLIST=10.0.0.0/8,172.16.0.0/12                   # ★ Strong control: only allow corporate intranet/egress
# PROXY_SHARED_KEY=a-long-random-string                 # optional, corresponds to VITE_OAUTH_PROXY_KEY
RATE_LIMIT_PER_MIN=60
```
- **"Whoever can call the proxy = whoever is a company employee"**: bind the proxy to the intranet / make it reachable only via VPN + `IP_ALLOWLIST`; even stronger is to front it with enterprise SSO in nginx (oauth2-proxy / Authelia). See [`oauth-proxy/README.en.md`](oauth-proxy/README.en.md) and [`oauth-proxy/nginx.conf`](oauth-proxy/nginx.conf).
- Docker: `cd docs/oauth-proxy && docker compose up -d --build`; a systemd example is at the end of `oauth-proxy-server.mjs`.
- The proxy only exchanges tokens and **never handles any user data**; for why this is secure, see the "★ App Secret and OAuth security model" diagram in SECURITY_AUDIT.

---

## 5. Outbound lockdown & pure-intranet verification

After a private-deployment build, the extension can **only** reach two kinds of hosts, locked down two ways:
- **Code layer**: `isFeishuOutboundAllowed` only allows `*.<domain>` subdomains + the proxy host; the LLM is restricted to `VITE_OPENAI_ALLOWED_HOSTS` by `assertSafeBaseUrl`.
- **CSP layer**: `connect-src` lists only `https://*.<domain>`, the proxy host, and the pinned LLM host — **no bare `https:` wildcard**.

Hosts the browser must be able to reach: `open.<domain>` (API), `accounts.<domain>` (OAuth consent popup), `<tenant>.<domain>` (the document pages themselves), the proxy host, and `llm.<domain>`. Make sure the intranet DNS/gateway reaches all of them.

> The sandbox (data visualization / PPT / website / dashboard) runs LLM-generated code with **`connect-src 'none'`**: even if it gets the data, it cannot send it out — independent of the outbound lockdown.

---

## 6. Automatic API version fallback (self-hosted versions lag behind SaaS)

Self-hosted instances often lag behind on OpenAPI versions. This build **does not hardcode versions**: once `VITE_FEISHU_BASE_DOMAIN` is set (i.e., private deployment), if `/<service>/vN/...` returns **404** on an older instance, the request layer automatically falls back to `v(N-1)` step by step down to `v1`, and **remembers the working version** to go straight there afterward.
- Safety: 404 = the gateway matched no path = the request **was not executed**, so even a downgraded write operation will not create duplicates.
- Covers all data APIs: bitable / docx / sheets / drive / wiki, etc.; OAuth token exchange is excluded (its shape differs across versions).
- Implementation: `src/shared/feishu/version.ts` + `http.ts feishuFetch`; tests `version.test.ts` / `http.version.test.ts`.

---

## 7. Network access restriction (optional, CIDR)

After setting `VITE_ALLOWED_CIDRS`, if the local IP detected by the browser is not within the subnets, the extension is **locked** (usable only on intranet/VPN).
> ⚠️ Modern Chrome obfuscates WebRTC candidates with mDNS by default, so it may fail to obtain the LAN IP → detected as empty. If intranet users are wrongly locked out, **prefer gateway-layer restrictions (IP/SSO) over this option**; or evaluate before enabling.

---

## 8. Least-privilege permissions (one-time in the Feishu admin console)

- **Availability scope**: add employees/departments (determines who can authorize).
- **Redirect URL**: `https://<your-extension-ID>.chromiumapp.org/` (including the trailing slash).
- **scope**: enable **`offline_access` (required, otherwise the token expires in about 2h and cannot be refreshed, reporting 99991677)** + as needed `bitable:app`/`docx:document`/`sheets:spreadsheet`/`drive:drive`/`wiki:wiki`/`contact:user.base:readonly`, **and only check "user identity", not "app identity"** — that way even if the secret leaks, the tenant token cannot read or write data.
- **Do not enable**: `im` / `contact:contact` / `transfer_owner` / `permissions` / `admin` (the code also hard-forbids these).
- **Remove delete permissions**: use fine-grained permissions for Base and do not check "delete"; see SECURITY_AUDIT for details. The code layer also hard-forbids file-level deletion, and content deletion requires confirmation.

---

## 9. Credential and secret management

- **App Secret**: in proxy mode it **never enters the bundle**; it exists only on the proxy server (systemd `Environment=` / Docker secret / K8s Secret).
- **Rotation**: on suspected leak or on a schedule → reset the Secret in the Feishu admin console → update the value in the proxy (the extension needs no rebuild because it carries no secret).
- **LLM Key**: each user fills it in under "Settings" (it does not enter the build).
- **Repo hygiene**: `feishu-app-config.txt` / `.env*` / `*.pem` are already `.gitignore`d; never commit them, and delete them once used.

---

## 10. Distribution and forced install

Private deployment does not go to the store: build the `.crx` (the project private key pins the extension ID) → host the `.crx` + `update_manifest.xml` on intranet HTTPS → push the forced-install policy (Google Admin console / Windows GPO / macOS MDM, with a ready-made `.mobileconfig`). **For the full steps see** [`enterprise/DEPLOY.en.md`](enterprise/DEPLOY.en.md).

---

## 11. Intranet LLM (OpenAI-compatible)

- Any OpenAI-compatible service works (vLLM / Ollama / self-built gateway). The user fills in **Base URL + Key + model** under "Settings".
- The Base URL **must fall within `VITE_OPENAI_ALLOWED_HOSTS`**, otherwise it is rejected by `assertSafeBaseUrl` (this is exactly the pure-intranet guarantee).
- Vision capability (screenshot recognition) requires a vision-capable model.

---

## 12. Upgrade procedure

1. Change code/config → `npm run build` (manifest `version` +1).
2. Rebuild the `.crx` (**same private key**) → overwrite the intranet `.crx`.
3. Update the `version` in `update_manifest.xml` → overwrite it.
4. Managed browsers auto-update within a few hours (or on restart); if urgent, have users click "Update" on `chrome://extensions`.
5. The proxy / Feishu admin console generally need no changes; when rotating the secret, only update the proxy environment variable.

---

## 13. End-to-end verification checklist

- [ ] The `connect-src` in `dist/manifest.json` contains only intranet hosts (no bare `https:`).
- [ ] `grep -r <AppSecret> dist/` is empty (no secret in the bundle).
- [ ] Proxy `curl https://feishu-proxy.your-domain/healthz` → `{"ok":true}`.
- [ ] The browser can resolve/reach `open./accounts./<tenant>.your-domain`, the proxy, and `llm.your-domain`.
- [ ] Feishu admin console: availability scope includes the tester, redirect URL is correct, scope checks only user identity.
- [ ] Load the extension → Settings → Feishu authorization → consent → **the proxy log shows `grant=authorization_code status=200`**.
- [ ] Run a feature (create a table / summarize / generate PPT) successfully; if it hits an old-version endpoint, logs/behavior show automatic fallback to the working version.
- [ ] (If CIDR is enabled) usable on the intranet, locked when offline / on a different subnet.

---

## 14. Troubleshooting

| Symptom | Investigation |
|---|---|
| OAuth 401/403 / consent page won't open | Redirect URL, availability scope, scope not fully configured; `accounts.<domain>` unreachable |
| Proxy `redirect_uri_forbidden` | The proxy's `ALLOWED_REDIRECT_URIS` does not match the extension's actual callback (check the proxy log) |
| Proxy `invalid_grant` | Authorization code expired/reused; re-click authorize |
| An operation returns 404 but the capability should be supported | Self-hosted version lags behind; already auto-falls-back (§6); if it still fails, the endpoint may simply not be live in the private version |
| LLM request rejected | Base URL is not within `VITE_OPENAI_ALLOWED_HOSTS` |
| Full-screen "Checking network access permission" | `VITE_ALLOWED_CIDRS` + WebRTC cannot obtain the LAN IP (§7); switch to gateway restriction |
| 403 no edit permission | The resource is not yours / not shared with the app; operate as yourself or add a collaborator under the doc's "Share" |

---

## 15. Security model

For the line-by-line audit, attack scenarios, App Secret/OAuth diagrams, outbound lockdown (M7), sandbox isolation (M9), and more: see [`SECURITY_AUDIT.en.md`](SECURITY_AUDIT.en.md). In one sentence: **pure intranet, user identity, no secret in the bundle, two-layer outbound lockdown, and generated code runs in a network-less sandbox.**
