> 🌐 **English** | [中文](PROJECT.md)

# Feishu Doc AI Assistant — Master Project Document

> Single-file authoritative reference. Covers: project overview / software architecture / implemented features / security design / supported scenarios /
> customization / packaging / deployment / configuration.
> Companion docs: module details in [ARCHITECTURE.en.md](../ARCHITECTURE.en.md); the line-by-line security audit in [SECURITY_AUDIT.en.md](../SECURITY_AUDIT.en.md).
> Snapshot: 2026-05-31. Tests: 177 passed / 32 skipped.

---

## 1. Project Overview

A Chrome **MV3 side panel extension** that uses natural language to drive Feishu's three core products via AI: **Base / Spreadsheet / Docs** — create tables, fill in data, write formulas, generate documents, revise drafts from comments, look up data across tables, deduplicate, and audit.

- **Form factor**: Side Panel + Content Script (injected into Feishu pages to extract context / perform DOM automation) +
  Background Service Worker (lifecycle).
- **AI**: OpenAI-compatible API, defaulting to a Chinese LLM (DeepSeek); model / Key / BaseURL are configurable at runtime.
- **Tech stack**: Vite + React 18 + TypeScript; the only runtime dependencies are `react` / `react-dom` / `openai`
  (deliberately minimal dependencies, no backend).
- **Packaging**: `vite-plugin-web-extension`; the `key` in `manifest.json` pins the extension ID.
- **Quality**: 177 unit tests (vitest); all critical security / data checkpoints are covered.

---

## 2. Software Architecture

### 2.1 The Three MV3 Components
```
side panel (React)  ←—messages—→  background SW  ←—messages—→  content script (Feishu page)
   chat/scenario/settings              lifecycle              extract PageContext / DOM automation
```

### 2.2 Directory Structure (src/)
```
shared/
  config.ts            build-time config + derived endpoints + outbound allowlist (core of multi-deployment)
  crypto.ts            AES-256-GCM (device seed) — encryption of stored credentials
  url.ts               safeHttpUrl/safeImageSrc — guards against untrusted URLs
  providers.ts         LLM provider presets + assertSafeBaseUrl (endpoint validation)
  network.ts           device IP/CIDR intranet gate
  theme.ts types.ts
  ai/
    agent.ts           agentic loop, tool dispatch, all security checkpoints, system prompt
    tools.ts           schemas for the 50 tools
  feishu/
    auth.ts            resolveToken (user identity) / getValidUserToken (auto-renewal)
    oauth.ts           OAuth + optional proxy requestToken
    appSecret.ts       runtime unlock of password-encrypted secret
    http.ts api.ts     OpenAPI wrapper (robustFetch + outbound guard)
    sheets.ts docx.ts  Spreadsheet / Docs primitives
    compose.ts         composite operators (dedup / cross-table / batch edit / audit, atomic)
    context.ts         fetchBaseCtx reads table structure
    export.ts pageUrl.ts
  templates/
    engine.ts          template execution engine (create tables + fill data + dashboard)
    registry.ts        remote template fetch + sanitize
    builtin/           crm / ecommerce / project built-in templates
sidepanel/
  App.tsx              view routing / context detection / network gate
  components/          ChatPanel / ScenarioPanel / Settings / MessageList / various dialogs
  sessions/            multi-session management (per-document binding + cap)
background/ content/   SW + injected script
harness/ dev/          offline test driver / mock
```

### 2.3 The Agentic Loop (agent.ts `runAgent`)
1. `assertSafeBaseUrl` validates the LLM endpoint → build the OpenAI client.
2. `buildSystemPrompt` (with context + security policy) + `buildApiHistory` (pairs tool_calls, tolerates truncation).
3. Streaming loop: the model emits text/tool calls → **security checkpoints** (see §4) → `executeTool` → results fed back →
   until there are no more tool calls or the cap (20) is reached. Can be cancelled via `AbortSignal` (unload/resend).
4. Each round's bubble is rendered in order; write operations are not retried, and creation is deduplicated (prevents duplicate table creation).

### 2.4 Key Data Flows
- **Token**: `resolveToken` always returns a **user_access_token** (OAuth or manual entry), auto-renewed;
  never uses the tenant identity.
- **Sessions**: bound to an independent session keyed by the current document's appToken; each session keeps at most 20 messages (oldest evicted),
  stored in shards in `chrome.storage.local`.
- **Context**: the content script / URL resolves the Base/Sheet/Doc/Wiki; wiki async resolution has a stale-guard.

---

## 3. Implemented Features

### 3.1 Tools (50, by domain)
- **Base**: create/modify/delete tables, fields (including single-select / multi-select / date / link / formula and other types), views, records
  (single/batch create, update, delete), search (structured filtering), attachments, etc.
- **Spreadsheet**: create sheets, read/write ranges, append rows, fill columns, find and replace, number formats, insert/delete rows and columns.
- **Docs**: create documents, Markdown-to-doc conversion, read body, insert content blocks (paragraph/heading/list/quote/code/divider/
  to-do), insert tables, delete content blocks.
- **Composite capabilities** (compose.ts, with atomicity / partial-failure reporting): dedup, cross-table lookup, conditional batch update, table→table rollup, audit.
- **Generic API** (`feishu_api_call`): for needs not covered above, build requests per the official docs — strictly limited by a **deny-by-default allowlist**.
- **Interaction**: `ask_user` (pops a choice card), destructive deletes pop a button confirmation.

### 3.2 Template Scenarios (one-click database setup)
Built-in CRM / E-commerce / Project Management; a remote template library (registry, with schema validation) can be configured. Failures get retried / returned.

### 3.3 Experience
Configurable accent color, skeleton screens, fade-in animations, automatic pause on non-Feishu pages (side panel not opened / collapsed),
per-round bubbles in order, clickable markdown links, cover images, export as template JSON.

### 3.4 Optional Enhancements (toggles in Settings)
- **Gets smarter with use**: after each success, the model distills "the most reliable way to do this next time" into a single tip stored locally (up to 300 tips; only the method is stored, never the data; repeated tasks just increment a counter and don't re-consume), automatically referenced for similar tasks next time; can be cleared.
- **Auto mode**: automatically confirms in-document content deletions (rows / fields / content blocks / dedup), no longer requiring per-action confirmation;
  **file-level deletion is always hard-blocked** and is not relaxed even in Auto mode. Off by default.
- **Voice input** 🎤: browser speech recognition (zh-CN) transcribes to text into the input box. ⚠️ It goes through Google services and sends audio out,
  so it is only enabled in the default public-network build; private / locked-down builds disable it automatically.

---

## 4. Security Design

> Core principle: **the AI always acts as the user themselves, and all permission boundaries are hardcoded in the code** (the prompt only guides / reports errors,
> it is not a security boundary). See [SECURITY_AUDIT.en.md](../SECURITY_AUDIT.en.md).

### 4.1 Three Fundamental Principles (enforced in code)
- **P1 Creation belongs to the user**: operating with user_access_token → newly created documents naturally belong to the user.
- **P2 File-level deletion is always rejected**: `isFileLevelDelete` intercepts at both the agent loop and executeTool
  `delete_table` / `delete_sheet` / any `feishu_api_call` DELETE; content-level deletions (rows / fields / blocks / dedup)
  are allowed but **pop a button confirmation**.
- **P3 Permissions never exceed the user**: `resolveToken` uses only the user identity, **never falls back to tenant**; permission errors are reported faithfully.

### 4.2 Anti-injection / Privilege Escalation
- The generic API is **deny-by-default with an allowlist** (only bitable/sheets/docx/drive and other business subpaths) + hard blocks on
  messaging / contacts / permissions / ownership + path-traversal interception.
- `isPermissionError` is error-code-driven (precise, few false positives).

### 4.3 Data Robustness
- Atomic batch operations, partial failure reported as `partial_failure`; post-write verification against the actual count; write operations not retried +
  creation deduplicated (prevents duplicate / orphan tables); `robustFetch` has a 30s timeout and GET retries.

### 4.4 Credential Protection (three App Secret modes)
| Mode | Config | In the package | If an attacker gets the package |
|---|---|---|---|
| Personal · plaintext | `VITE_FEISHU_APP_SECRET` | plaintext | grep it directly ❌ |
| Personal · encrypted | `VITE_FEISHU_APP_SECRET_ENC` (generated by `scripts/encrypt-secret.mjs`) | ciphertext only | must brute-force the password (PBKDF2 210k) ✅ |
| Enterprise / private · proxy | `VITE_OAUTH_PROXY_URL` (see `docs/oauth-proxy-worker.js`) | no secret | can't get it ✅✅ |
- Tokens/secrets in storage are encrypted with `crypto.ts` AES-256-GCM (PBKDF2(extension ID + device seed)).
- The user token auto-renews (refresh_token stored encrypted), so long sessions stay logged in.

### 4.5 Outbound and Network Lockdown
- **Only two kinds of endpoints are accessed**: Feishu + the LLM. At the code layer, `isFeishuOutboundAllowed` (subdomains of the base domain) +
  `assertSafeBaseUrl` (LLM); at the CSP layer, `connect-src` is locked per deployment (in private mode the `https:` wildcard is removed → pure intranet).
- The model endpoint allowlist `VITE_OPENAI_ALLOWED_HOSTS` prevents conversation/table content leakage.
- The device intranet gate `VITE_ALLOWED_CIDRS` (if the device IP is out of range, the extension is locked).
- Explicit CSP: `script-src 'self'` (no inline/eval), tightened `object-src/base-uri/frame-ancestors`.
- Remote template registry: localhost banned in production + schema validation + unsafe covers stripped; image/link src restricted to http(s).

---

## 5. Supported Scenarios (deployment matrix)

| | Personal | Enterprise SaaS | Private (on-prem) |
|---|---|---|---|
| App Secret | plaintext or **password-encrypted** | proxy (not in package) | proxy (intranet, not in package) |
| `VITE_OAUTH_PROXY_URL` | — | ✓ | ✓ (intranet) |
| `VITE_FEISHU_BASE_DOMAIN` | feishu.cn (default) | default | intranet domain (e.g. test.com) |
| `VITE_OPENAI_ALLOWED_HOSTS` | — | optional | intranet LLM |
| connect-src lockdown | `https:` (broad) | optional | only `*.<domain>` + LLM (pure intranet) |
| `VITE_ALLOWED_CIDRS` (device intranet) | — | optional | ✓ |
| Distribution | manual load / packaging | forced install via Chrome enterprise policy | same as left (intranet) |

Private-deployment key point: **just swap the base domain suffix**; `open.<domain>` / `accounts.<domain>` / `<tenant>.<domain>` are all derived,
and the API paths and call conventions are exactly the same.

---

## 6. Customization

### 6.1 Local Development
```bash
npm install
cp .env.example .env.local     # fill in config (see §9)
npm run dev:ext                # extension dev mode (HMR), load dist into chrome://extensions
npm run dev:ui                 # pure UI preview (mock chrome, not connected to Feishu)
npm run typecheck && npm run test
```

### 6.2 Adding a Tool
1. Add the schema (name/description/parameters) in `shared/ai/tools.ts`.
2. Add the implementation in the `executeTool` dispatch in `shared/ai/agent.ts` (or categorize it into SHEET_TOOLS/DOC_TOOLS).
3. The underlying call goes through `shared/feishu/api.ts` (Base) or sheets/docx; **any new delete/write must be brought into the §4 checkpoints**
   (destructive into `DESTRUCTIVE_TOOLS`, file-level into `FILE_LEVEL_DELETE_TOOLS`, creation into `CREATE_ONCE_TOOLS`).
4. Add unit tests.

### 6.3 Adding a Template
In `shared/templates/builtin/`, write a `ScenarioTemplate` modeled on `crm.ts` and export it in `builtin/index.ts`.
See ARCHITECTURE for the field-type codes; link/Lookup/formula fields skip sample data. Or use the remote registry.

### 6.4 Adding an LLM Provider
Add an entry (id/name/baseUrl/models/region) to `LLM_PROVIDERS` in `shared/providers.ts`.

### 6.5 Testing Conventions
- Pure logic / operators go in `*.test.ts` (vitest node).
- Components use `// @vitest-environment jsdom` + testing-library.
- Cases that need real devices/network are marked skip (live.test.ts) and run offline via the harness/driver.
- Changes to security checkpoints trigger the corresponding tests (agent/config/providers/appSecret, etc.) — a red test means you touched a boundary.

---

## 7. How to Package

```bash
# Personal · encrypted secret (recommended):
node scripts/encrypt-secret.mjs          # enter secret + unlock password → get ciphertext
# Write into .env.local: VITE_FEISHU_APP_SECRET_ENC=<ciphertext>, and clear VITE_FEISHU_APP_SECRET
npm run build                            # output in dist/
```
- `dist/` is the unpacked extension; the `key` in `manifest.json` pins the ID (consistent across devices → stable OAuth redirect URL).
- Verify: `grep -r <plaintext-secret> dist/` should yield **no results** (in an encrypted build the plaintext never enters the package).
- Private / proxy build: set the corresponding env (§9) then `npm run build`; `vite.config` templates
  `host_permissions` / `content_scripts` / `connect-src` based on the env.

---

## 8. How to Deploy

### 8.1 Self-test / Small Scale (load unpacked)
1. Copy `dist/` to the target machine → `chrome://extensions` → Developer mode → "Load unpacked".
2. One-time setup in the Feishu admin console: **Security Settings → Redirect URL**, add `https://<extension-ID>.chromiumapp.org/` (trailing slash).
3. While the app is in the "Testing" phase: the target account must be added as a **test member**; scopes are enabled once in the app console.
4. Side panel: unlock the secret (encrypted mode) → authorize with your Feishu account → enter the LLM Key.

### 8.2 For Everyone (100,000 people)
- **Feishu app**: create a version → submit for release → admin review → set the **availability scope** (all / departments) → everyone in scope authorizes directly,
  **no need to add test members one by one**; scopes / redirect URL are configured only once.
- **Extension distribution**: IT force-installs uniformly via the Chrome enterprise policy **ExtensionInstallForcelist**; users don't need to load manually.
- **Remove the secret**: use the OAuth proxy (`docs/oauth-proxy-worker.js`, setting two server-side secrets `FEISHU_APP_ID/SECRET`).
- **Private deployment**: set the base domain to the intranet, set `OPENAI_ALLOWED_HOSTS` to the intranet LLM, and set the proxy to the intranet → fully intranet outbound.

---

## 9. How to Configure

### 9.1 Build-time (`.env.local`, all optional; see `.env.example`)
| Variable | Purpose |
|---|---|
| `VITE_FEISHU_APP_ID` | Feishu App ID |
| `VITE_FEISHU_APP_SECRET` | plaintext secret (personal · plaintext; mutually exclusive with the two below, pick one) |
| `VITE_FEISHU_APP_SECRET_ENC` | password-encrypted secret (personal · encrypted; generated by `scripts/encrypt-secret.mjs`) |
| `VITE_OAUTH_PROXY_URL` | OAuth proxy address (enterprise / private, secret not in package) |
| `VITE_FEISHU_OAUTH_SCOPE` | space-separated scopes (bitable:app docx:document sheets:spreadsheet drive:drive wiki:wiki …) |
| `VITE_FEISHU_BASE_DOMAIN` | Feishu base domain suffix, default feishu.cn; for private deployment, fill in the intranet domain |
| `VITE_OPENAI_ALLOWED_HOSTS` | comma-separated LLM host allowlist (if set, CSP is locked too → pure intranet) |
| `VITE_ALLOWED_CIDRS` | device intranet CIDR gate (if the device IP is out of range, the extension is locked) |
| `VITE_DEFAULT_REGISTRY_URL` | default remote template library (localhost banned in production) |

### 9.2 Runtime (the side panel "Settings", not packaged)
- LLM: provider preset / Base URL / API Key / Model (default DeepSeek).
- Feishu: unlock password (encrypted mode), authorize with your Feishu account (OAuth), open_id, optional manually-entered user_access_token.
- Accent color, template-library URL override.
- Toggles: gets smarter with use (on by default), Auto mode (off by default, with a warning), voice input (on by default, visible only in public-network builds).

### 9.3 Security Conventions (must be followed)
- All credential files are gitignored: `.env.local` / `*token*.txt` / `feishu-app-config.txt` / `deepseek-*.txt` /
  `unlock-password.txt` / `extension-key.pem` / `*.zip` — **never commit them**.
- Keep **only one** of plaintext and encrypted secret (keeping the plaintext is the same as not encrypting).
- The unlock password cannot be recovered (the key is derived from it); if lost, re-run `encrypt-secret.mjs` and repackage.
- L5 (in personal · plaintext mode the secret is in the package) is an inherent limitation of MV3 with no backend; two paths ("encryption / proxy") are provided to eliminate it.
