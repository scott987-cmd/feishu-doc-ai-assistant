> 🌐 **English** | [中文](ENTERPRISE.md)

# Enterprise deployment guide (private / SaaS / managed, for org-scale rollouts)

> For platform / IT / security teams. This doc answers three things: **how the editions (SaaS vs private vs managed) actually differ**, **how to use the enterprise managed suite**, and **what's still missing to roll it out to 100,000 employees (an honest maturity assessment)**.
> See also: [`DEPLOYMENT.en.md`](DEPLOYMENT.en.md) · [`PRIVATE_DEPLOYMENT.en.md`](PRIVATE_DEPLOYMENT.en.md) · [`enterprise/DEPLOY.en.md`](enterprise/DEPLOY.en.md) (MDM force-install) · [`SECURITY_AUDIT.en.md`](SECURITY_AUDIT.en.md) · [`ARCHITECTURE.en.md`](ARCHITECTURE.en.md).

---

## 1. In one line: how it has "editions"

This is **one** Chrome MV3 extension — **one codebase, no backend**; every operation runs as the **user's own Feishu identity** (OAuth `user_access_token`, **never** falling back to tenant).

"Editions" are **not forks or different codebases** — they are **build-time** `VITE_*` env vars (read only from `.env` files) folded into `BUILD_CONFIG` in `src/shared/config.ts`, which derive a set of feature flags. **All editions share the same hard security boundaries** (see [SECURITY_AUDIT](SECURITY_AUDIT.en.md)). Key design: **every enterprise feature is double-gated as `flag && oauthProxyUrl`** — so a build without a proxy (the store build) **dead-code-eliminates** all enterprise networking; an enterprise endpoint string literally cannot be found in a store bundle.

## 2. Private vs SaaS vs Managed (the core comparison)

| Dimension | Store / SaaS | Personal self-distributed | Private (on-prem) | Enterprise managed |
|---|---|---|---|---|
| For whom | individuals / small teams on Feishu public cloud | small trusted teams | self-hosted (private) Feishu + intranet LLM | org-scale, needs central control |
| Feishu domain | `feishu.cn` (public) | `feishu.cn` | **custom** `VITE_FEISHU_BASE_DOMAIN` (derives `open./accounts./<tenant>.`) | SaaS or private domain |
| Credentials (App Secret) | **user-entered** (BYO), device-encrypted, **zero in the bundle** | baked: plaintext (`.crx` is confidential) or password-encrypted (`appSecretEnc`) | **server-side** (OAuth proxy); bundle holds only App ID + proxy URL | same as private; proxy may also **serve a managed App ID** (`app_config`; App ID is public) |
| LLM | user-entered key | can be preset | intranet LLM, host allowlist pinned | proxy may **serve managed LLM** (`llm_config`; key only to verified tenant members, memory-only, lockable) |
| OAuth proxy | none | none | **recommended** (`oauth-proxy-server.mjs`; token exchange only, never touches user data) | **required** (also mounts managed config / skills / artifact backup / admin) |
| Egress | Feishu + the user's LLM | same | pure-intranet when pinned (`VITE_OPENAI_ALLOWED_HOSTS` + CSP) | same as private |
| API versions | follows SaaS | follows SaaS | **auto fallback** `/vN/`→`v(N-1)` (private OpenAPI lags; reads only, avoids write dupes) | same as private |
| Central policy / control | none | none | optional | **yes**: central policy (force/lock toggles), **fail-closed**, skills library, cloud backup, admin console |
| Distribution | Chrome Web Store | self-distributed `.crx` | self-hosted `.crx` + `update_manifest.xml` + MDM force-install (fixed ID) | same as private (MDM/GPO) |

> **Decision**: public cloud + BYO credentials → **Store**; self-hosted Feishu / intranet LLM → **Private**; org-scale + central config/policy/audit → **Enterprise managed** (layered on private or SaaS).

Build-time variables (full list in [`.env.example`](../.env.example)): `VITE_FEISHU_BASE_DOMAIN` (domain → public/private) · `VITE_OAUTH_PROXY_URL` (its presence is what makes a build "enterprise") · `VITE_FEISHU_APP_SECRET[_ENC]` · `VITE_OPENAI_ALLOWED_HOSTS` (LLM host allowlist, **also pins CSP**) · `VITE_ALLOWED_CIDRS` (device-side gate, **UX hint only**, see §5) · `VITE_NO_REMOTE_CODE` (drop `unsafe-eval`, see §4) · `VITE_WEBSTORE` (store build, force-clears creds/proxy).

## 3. The enterprise managed suite (optional · one zero-dependency Node process)

Mounted **in the same process** as the token-exchange proxy, all double-gated `HAS_* = flag && proxy`:

- **Managed App ID/Secret** (`app_config`): zero per-user setup; the Secret lives only server-side and is rotatable.
- **Managed LLM** (`llm_config`): base URL/key/model handed only to **verified tenant members**; `llmLockManaged` (locked) and `llmNoPersist` (key in memory only, never shipped to clients).
- **Central policy** (`policy`): force/lock `autoConfirm` etc.; **fail-closed** — when the proxy is unreachable, destructive auto-confirm stays OFF (an outage tightens, not loosens, safety).
- **Shared skills library** (`/skills/*`, `skill-proxy-server.mjs`): de-identified lessons aggregated / de-duped / scored / promoted / pushed across users (**tool names + abstract intent only — never raw task text/data**).
- **Cloud artifact backup** (`/artifacts/*`, `artifact-proxy-server.mjs`): mini-apps/sites/slides mirrored to the **enterprise's own object storage**, isolated by `open_id`, optional AES-GCM.
- **Admin console** (`/admin`, `admin-server.mjs` + `admin-ui.html`): dashboard / skills review / backup management / config inspection / audit.

> Deploy: [`oauth-proxy/`](oauth-proxy/) (Dockerfile + compose + nginx + README). `docs/sim/validate-server.mjs` makes 29 synthetic end-to-end assertions against these endpoints (`npm run validate:server`, no real Feishu).

## 4. Security hardening (default vs hardened posture)

The default build is friendly to individuals; to meet the "no exfiltration" promise, harden explicitly:

- **LLM egress**: `assertSafeBaseUrl` enforces the host allowlist **only when `VITE_OPENAI_ALLOWED_HOSTS` is non-empty**; the default CSP `connect-src` includes a bare `https:` (to support BYO OpenAI-compatible endpoints). **The "no exfiltration" guarantee requires pinning `VITE_OPENAI_ALLOWED_HOSTS`** (which also tightens CSP to Feishu + your LLM origin).
- **No remote code**: LLM-generated render code runs via `new Function` in the sandbox (opaque origin + `connect-src:'none'`) and keeps `unsafe-eval` by default. **Recommended for enterprise/store releases: set `VITE_NO_REMOTE_CODE=1`** — declarative `VizSpec` rendering, **zero `unsafe-eval`** in the bundle (asserted in CI by `scripts/check-no-eval.mjs`).
- **Public-bundle zero-leak**: `scripts/check-store-bundle.mjs` (in CI) asserts the store bundle contains **no enterprise endpoint strings and no baked secret** — turning the manual "verify endpoints = 0" step into an enforced gate.
- **Credential storage**: AES-256-GCM in `chrome.storage` (device-seed PBKDF2); App Secret in three tiers: plaintext / password-encrypted (`appSecretEnc`) / proxy (never in the bundle).

## 5. Rolling out to 100k: mass deployment

- **Force-install** (no store, no developer mode): self-hosted `.crx` + [`enterprise/update_manifest.xml`](enterprise/update_manifest.xml) + Chrome `ExtensionInstallForcelist`; a ready-made macOS [`.mobileconfig`](enterprise/feishu-ai-chrome-forceinstall.mobileconfig) is included. The extension ID is fixed by the `manifest.json` `key`. See [`enterprise/DEPLOY.en.md`](enterprise/DEPLOY.en.md).
- **Version/updates**: keep the version in sync across `manifest.json`, `update_manifest.xml`, `package.json` (CI now checks for drift); on upgrade **keep the prior `.crx`** for rollback and stage by OU/percentage.
- **Network control**: the `VITE_ALLOWED_CIDRS` device-side WebRTC check is **a UX hint only**; the **authoritative boundary belongs on the proxy** (IP allowlist + intranet/VPN + SSO in front of `/admin`, e.g. oauth2-proxy / Authelia).
- **CN vs international**: one build serves one `VITE_FEISHU_BASE_DOMAIN`; **Feishu (CN) and Lark (international) require separate builds**.

## 6. Data flow & compliance

- **Core extension: no backend, no telemetry** — no silent reporting (see [`PRIVACY.md`](../PRIVACY.md)). Data flows between the user's browser ↔ Feishu ↔ the LLM the user/enterprise chose.
- **Enterprise managed adds server-side components** procurement/compliance must assess: ① the OAuth proxy (token exchange only, never user business data); ② the managed-LLM relay (**the company LLM sees the prompt content sent to it**; `VITE_LLM_REDACT` does PII redaction with a payload cap, but redaction is not a silver bullet); ③ the shared skills library (de-identified intent, not raw data); ④ cloud backup (lands in the **enterprise's own** object storage, optionally AES-GCM).
- **Data residency**: private Feishu + intranet LLM + enterprise-owned storage = data never leaves the enterprise boundary. CN (PIPL) / international (GDPR) compliance and a DPA are self-assessed by the deployer against the flows above.

## 7. Maturity assessment (honest: ready vs what's missing)

**Bottom line**: the code and security posture already meet a high enterprise bar; **a competent platform team can self-host the private edition today**. To be **turnkey at 100k**, the real gaps (in priority order — all operational/engineering maturity, **not correctness defects**) are:

- ✅ **CI** (added here, `.github/workflows/ci.yml`): typecheck/test/validate/build + the store-bundle safety gate + a version-drift check, so external contributors get feedback.
- ⬜ **Native managed policy** (Chrome `storage.managed` / `managed_schema`): central config currently flows through build-time env vars or the custom proxy; large orgs expect to push domain / proxy / App ID / LLM allowlist / CIDRs / autoConfirm-lock via the **same MDM/GPO** that force-installs. **This is the most valuable next item.**
- ⬜ **Audit observability**: the admin audit is a 500-entry in-memory ring with **no persistence / no SIEM export**, and there is no per-user data-operation trail — large orgs need to answer "who mass-edited which doc when."
- ⬜ **Admin auth**: a single shared password, **no RBAC / SSO**; at scale, put SSO in front of `/admin` and pass the authenticated identity into the audit.
- ⬜ **i18n**: the UI is Chinese-only, with no i18n framework yet.
- ⬜ **CN + international single build**: separate builds are required today.

> Contributions to the roadmap are welcome — see [`CONTRIBUTING.en.md`](../CONTRIBUTING.en.md).
