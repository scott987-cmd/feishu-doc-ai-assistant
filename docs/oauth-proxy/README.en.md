> 🌐 **English** | [中文](README.md)

# Feishu OAuth Proxy (Self-Hosted, No Cloudflare Required)

Keep the **App Secret server-side only** — not a single byte ships in the extension bundle. The client only sends authorization material (code / refresh_token); the proxy injects the secret server-side to exchange for a token, and returns "that user's own token" verbatim.

> See [`../../SECURITY_AUDIT.md` → ★ App Secret and OAuth Security Model](../../SECURITY_AUDIT.en.md) for the security model / flow diagram / threat matrix.
> The proxy itself: [`../oauth-proxy-server.mjs`](../oauth-proxy-server.mjs) (zero-dependency, Node ≥18).

---

## 1. Start a Local Proxy

### A. Docker (includes nginx, closest to enterprise deployment)
```bash
cd docs/oauth-proxy
cp .env.example .env          # 填 FEISHU_APP_ID / FEISHU_APP_SECRET / ALLOW_ORIGIN / ALLOWED_REDIRECT_URIS
docker compose up -d --build
curl http://localhost:8787/healthz     # → {"ok":true}
```
Chain: `extension → localhost:8787 (nginx) → oauth-proxy:8787 → Feishu`.

### B. Bare Node (fastest, for debugging)
```bash
FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=xxx \
ALLOW_ORIGIN=chrome-extension://jhdbgegkmhcopcilclkpioilclemkeog \
ALLOWED_REDIRECT_URIS=https://jhdbgegkmhcopcilclkpioilclemkeog.chromiumapp.org/ \
node docs/oauth-proxy-server.mjs
```

Gate checks (self-test): `/healthz` 200; wrong Origin → 403; invalid grant → 400; invalid redirect → 400.

## 2. Enterprise-Grade "Employees Only" (No Cloudflare)

The proxy only provides a baseline against abuse; "who can call it" is delegated to your intranet + identity gateway:

- **Strong**: bind the service to the intranet only / reachable via VPN only, and set `IP_ALLOWLIST=your company egress subnet`;
- **Stronger**: put SSO in front in `nginx.conf` (oauth2-proxy / Authelia / your company's zero-trust); only logged-in employees get through;
- **Add-on**: `PROXY_SHARED_KEY` + extension `VITE_OAUTH_PROXY_KEY` (deters casual abuse, not a strong secret).

In production, swap nginx's `80` for `443` + certificate. With multiple instances, replace the in-memory rate limiter in the proxy with Redis.

## 3. Build the Matching "Enterprise Extension Bundle" (Proxy Mode · Secret Not in the Bundle)

Build in proxy mode (no secret injected):
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
Then `chrome://extensions` → Developer mode → load `dist/` (or distribute the dist zip / repack a .crx).

## 4. One-Time Setup in the Feishu Admin Console

- **Availability scope**: add testers / all staff (this decides who can authorize).
- **Redirect URL**: add `https://jhdbgegkmhcopcilclkpioilclemkeog.chromiumapp.org/` (including the trailing slash).
- **Permission scopes**: check "user identity" only; remove `im` / `contact:contact` / `transfer_owner` / `permissions` / `admin`.

## 5. Enterprise Security Options (All via the Proxy, Available Only to Members of This Enterprise)

For both `llm_config` and `policy`, the proxy validates against Feishu's `user_info` using **the user's own user_access_token**, and only allows the request through if **`tenant_key == FEISHU_TENANT_KEY`** matches — so the company LLM key / policies are issued only to members of this enterprise.

| Capability | Proxy env | Client build |
|---|---|---|
| Centrally issue LLM config | `LLM_BASE_URL` `LLM_API_KEY` `LLM_MODEL` `FEISHU_TENANT_KEY` | `VITE_LLM_FROM_PROXY=1` |
| Lock down (forbid manual config) | — | `VITE_LLM_LOCK_MANAGED=1` |
| LLM key in memory only, never persisted | — | `VITE_LLM_NO_PERSIST=1` |
| Per-user config-fetch rate limit | `LLM_LIMIT_PER_HOUR=60` | — |
| Unified policy + lock switch | `POLICY_AUTO_CONFIRM` `POLICY_LEARN` `POLICY_NOTICE` | `VITE_ENTERPRISE_POLICY=1` |
| Outbound redaction + cap | — | `VITE_LLM_REDACT=1` `VITE_LLM_MAX_PAYLOAD_CHARS=20000` |

- Under "Settings" the user has an "Enterprise unified / Manual" switch (`VITE_LLM_LOCK_MANAGED` can lock it to enterprise-only).
- The proxy emits structured **audit logs**: `[audit] <time> ip=… action=llm_config|policy user=<open_id> status=…` (contains no token/content whatsoever).
- ✅ When `FEISHU_TENANT_KEY` is not set, issuance is **denied by default** (fail-closed) — it must be set for `llm_config`/`policy` to be enabled.
- ⚠️ Residual risk: the `tenant_key` check blocks **cross-tenant** access, but a **user token from another Feishu app within the same tenant** will also pass (this is an internal-member scenario, where legitimate access already exists). To fully bind to this app / ensure the key is never issued to the client, switch to **LLM gateway mode** (LLM calls also go through the proxy, metered per call) — more thorough, planned as follow-up.
