> 🌐 **English** | [中文](README.md)

<div align="center">

# 🪶 Feishu Doc AI Assistant

**A Chrome side-panel AI assistant that operates Feishu Docs / Base / Sheet from a single sentence**

*Feishu Document AI Assistant — operate Docs / Base / Sheet in natural language, from a side panel.*

[![License: Elastic License 2.0](https://img.shields.io/badge/License-Elastic%202.0-005571.svg)](LICENSE)
![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4285F4?logo=googlechrome&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![React 18](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-build-646CFF?logo=vite&logoColor=white)
![Tests](https://img.shields.io/badge/tests-371%20passing-success)
![No backend](https://img.shields.io/badge/backend-none-lightgrey)

</div>

Operate **Feishu Base (多维表格) / Sheet (电子表格) / Docs (文档)** directly through AI using natural language —
create tables, fill in data, write formulas, generate documents, revise drafts based on comments, do cross-table lookups, deduplicate, audit — all in a single sentence.

- **🤖 AI**: OpenAI-compatible interface, defaulting to a Chinese large model (DeepSeek); the model / Key / Base URL are configurable at runtime.
- **🧩 Form factor**: side panel + a content script injected into Feishu pages + a background Service Worker. The only runtime dependencies are React + the openai SDK, with **no backend**.
- **🔒 Security first**: the assistant always operates **as the user themselves**, never exceeding their privileges; all permission boundaries are **hardcoded in the code** (the prompt is not used as a security boundary).

## 🎬 Demo

[![Watch the demo video](https://img.youtube.com/vi/JhPNeOK1n8g/hqdefault.jpg)](https://youtu.be/JhPNeOK1n8g)

▶️ [Watch on YouTube](https://youtu.be/JhPNeOK1n8g) ·  Can't open YouTube? [Download the local demo mp4](docs/media/demo.mp4)

> 📚 **Full documentation** → [`docs/PROJECT.md`](docs/PROJECT.en.md) (architecture / features / security / deployment / configuration, all in one place)
> · **Deployment guide (quick start for enterprise / personal / private deployment)** [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.en.md)
> · User guide (with screenshots) [`docs/USER_GUIDE.md`](docs/USER_GUIDE.en.md)
> · Module details [`ARCHITECTURE.md`](docs/ARCHITECTURE.en.md) · Security audit [`SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.en.md)
> · Enterprise MDM forced install [`docs/enterprise/DEPLOY.md`](docs/enterprise/DEPLOY.en.md)

---

## 🚀 Personal quick start (5 steps)

> Full version (per-permission notes, encrypted mode, troubleshooting): [`docs/QUICKSTART.md`](docs/QUICKSTART.en.md).

1. **Configure the Feishu app** ([open.feishu.cn](https://open.feishu.cn) → create a custom app): note the App ID / Secret; under "Permissions" enable `offline_access` (required) + as needed `bitable:app` `docx:document` `sheets:spreadsheet` `drive:drive` `wiki:wiki` `contact:user.base:readonly` (**all under "User identity"**); add `https://jhdbgegkmhcopcilclkpioilclemkeog.chromiumapp.org/` to "Redirect URLs"; add yourself to "Availability" and **publish**.
2. **Fill config**: `cp .env.example .env.local` → set `VITE_FEISHU_APP_ID` + `VITE_FEISHU_APP_SECRET` (or run `node scripts/encrypt-secret.mjs` to get ciphertext for `VITE_FEISHU_APP_SECRET_ENC` and leave the plaintext empty).
3. **One-click package**: `npm install && npm run pack` (produces `dist/` and `feishu-doc-ai-assistant.zip`).
4. **Load**: `chrome://extensions` → Developer mode → "Load unpacked" → select `dist/`.
5. **Use**: open a Feishu Base/Doc → side panel → "Authorize with Feishu" in Settings + enter your LLM key → (for encrypted mode, enter the unlock password first) → start with one sentence.

---

## Features

- **AI conversational operations**: ~50 tools covering Base (create/modify tables, fields, views, add/update/delete records, structured search),
  Sheet (read/write ranges, fill columns, find and replace, add/delete rows and columns), and Docs (Markdown-to-document conversion, inserting various content blocks, revising drafts based on comments).
- **Composite capabilities**: deduplication / cross-table lookup / conditional batch updates / table-to-table aggregation / auditing (with atomicity and partial-failure reporting).
- **Generic API**: for needs not covered by the tools, build requests yourself according to the official documentation — strictly limited by a **deny-by-default allowlist**.
- **Scenario templates**: built-in CRM / e-commerce / project management, with a configurable remote template library; one-click base creation (table schema + sample data + dashboards).
- **Gets smarter the more you use it**: after each success, the model **distills "how to do it most reliably next time" into a single lesson** stored **on your machine** (up to 300 entries, storing only methods, not data);
  the next time a similar task comes up, it is automatically referenced to avoid detours; repeated tasks only increment a counter without re-consuming, and this can be turned off / cleared.
- **Auto mode**: automatically confirms content deletions within documents (file-level deletion is always hard-blocked); **voice input** 🎤 (public-internet build, zh-CN).
- **Web clipping** 📎: from any web page, via right-click / shortcut, **AI-organize selected content or whole-page tables and write them into Feishu Base / Sheet / Docs**; you can also drag in a CSV file to import.
  It reads the **current page** DOM only when **you trigger it with a gesture** (`activeTab`, local, no new outbound traffic, no need to loosen host_permissions); a **preview** is shown before sending.
- **AI mini-apps** 🧩: turn the current table into a floating mini-app on the Feishu page with a single sentence (draggable / resizable from all four corners) —
  **chart dashboards** (ECharts) / **calculators · interactive tools** / **printable reports** (window.print) / **presentation slides** / **card walls · timelines and other custom views**.
  The generated code and data are **decoupled** — after saving, open it again next time with the **latest data** in one click, with zero LLM calls; a single page can host multiple independent mini-apps (each with its own floating marker);
  the code runs **read-only render-only** inside the **MV3 sandbox** (null origin, `connect-src 'none'`), so **even with the data in hand, it cannot send anything out**. See [`ARCHITECTURE.md`](docs/ARCHITECTURE.en.md) for details.
- **AI site builder** 🌐: with a single sentence (optionally attaching a **reference site URL** as a style hint), turn the current table into a **complete website page** (navigation / hero section / metric cards / detail table),
  rendered as a floating page window. The sandbox **comes preloaded with a design system** — even a very terse description produces a **good-looking, consistent, on-brand** page;
  it is **offline and self-contained** (system fonts, no external links / CDN), with data binding (re-fetches the latest data on reopen), supports proposing a plan for confirmation first, can be fine-tuned with language, and can be saved.
- **AI smart fill** 🪄: in **Base / Sheet**, select a column and AI infers the **missing** values in that column by referencing the other columns in the same rows (and the examples you have already filled in) —
  auto-classify / tag / categorize / complete. **Preview every change before writing back**; single-select / multi-select only land on **existing options** (never creating new ones), and numbers / dates that fail to parse are skipped;
  it only **updates**, acts as the user, and only touches the current table (by default only fills blank cells); the write count is **based on Feishu's actual confirmation**, with no inflated reporting.
- **Data analysis report** 📈: reads the data of the current **Base / Sheet**, computes statistical summaries locally first, then AI writes an analysis report **with real numbers**
  (summary / key findings / trends and anomalies / recommendations), generates a Feishu **Doc**, and appends the source data table at the end. Feishu has "references" but no AI data narrative — this closes the loop by combining the table with writing into a document.
- **Document checkup** 🩺: reads through the current document and AI identifies **logical gaps / undefined terms / contradictions / leftover TODOs / stale data / empty subsections**,
  producing a locatable issue list sorted by severity (read-only, does not modify the document). It is the document version of `auditTable`; Feishu has no systematic review feature.
  **Check items can be opened and edited directly, persisted on your machine** — you define what gets checked.
- **Document summary** 📝: reads through the current document and generates a summary per your requirements (abstract / key points / to-dos…), which can be copied.
  The **summary requirements (prompt) can be edited directly and persisted on your machine** — Feishu's native AI quick-read is fixed, but here you call the shots.
- **Three deployment modes**: personal / enterprise SaaS / private (on-prem), all switched via build-time configuration.
- **Enterprise server suite** 🏢 (optional · one zero-dep Node process): on top of the token-exchange proxy, the same process mounts — **managed App ID / App Secret / LLM / policy** delivery (employees configure nothing, secrets stay server-side, rotatable), a **shared skill library** (de-identified cross-user lessons, dedup / score / promote / proactive push), **enterprise cloud backup** (mini-programs/sites/decks mirrored to the company's own object storage, isolated per open_id, optional AES, restorable on loss), and an **admin console** (`/admin`: dashboard / skill moderation / backup management / config inspector / audit). All double-gated `HAS_* = flag && proxy` → the store build (no proxy) **dead-code-eliminates it, zero release impact**. See [`docs/index.html`](docs/index.html).
- **Local backup & restore** 💾 (all builds): export config + saved artifacts + local lessons + sessions to a file; import to recover after a device change / reinstall (secrets excluded by default, opt-in).

---

## Quick start (development)

```bash
npm install
cp .env.example .env.local      # fill in as needed (see "Configuration" below); can be left fully empty to get running first
npm run build                   # output in dist/
# chrome://extensions → Developer mode → "Load unpacked" → select dist/
```

Development and quality:
```bash
npm run dev:ext     # extension hot reload (loaded into Chrome)
npm run dev:ui      # pure UI preview (mock chrome, not connected to Feishu)
npm run typecheck && npm run test
```

> For internal enterprise distribution (without listing on the store or using developer mode), see [`docs/enterprise/DEPLOY.md`](docs/enterprise/DEPLOY.en.md):
> use the project scripts to build a `.crx` + force-install via Chrome policy (includes a ready-made macOS `.mobileconfig`).

---

## Configuration (all optional, see [`.env.example`](.env.example))

**Runtime** (side panel → Settings): large model provider / Base URL / API Key / model; Feishu account authorization; accent color;
template library address; the "gets smarter the more you use it" toggle.

**Build-time** (`.env.local`, determines the deployment form):

| Variable | Purpose |
|---|---|
| `VITE_FEISHU_APP_ID` | Feishu App ID |
| `VITE_FEISHU_APP_SECRET` | Plaintext secret (personal · plaintext, ends up in the bundle) |
| `VITE_FEISHU_APP_SECRET_ENC` | Password-encrypted secret (personal · encrypted, generated by `scripts/encrypt-secret.mjs`) |
| `VITE_OAUTH_PROXY_URL` | OAuth proxy address (enterprise / private; secret does not enter the bundle, see `docs/oauth-proxy-worker.js`) |
| `VITE_FEISHU_BASE_DOMAIN` | Feishu base domain suffix, defaults to `feishu.cn`; for private deployment, fill in the intranet domain (derives `open.<domain>`, etc.) |
| `VITE_OPENAI_ALLOWED_HOSTS` | Large-model host allowlist (when set, CSP is also locked down → pure intranet) |
| `VITE_ALLOWED_CIDRS` | Device intranet CIDR gate |
| `VITE_MAX_TOOL_CALLS` | Per-turn tool-call limit (default 30) |
| `VITE_CLIP_ENABLED` | Web clipping toggle (on by default; set to `false` to ship without the clipping feature) |

---

## Security design (key points)

The assistant **operates with the user's own user_access_token**, with all permission boundaries enforced in code:

- **Never exceeds the user's identity**: AI cannot read documents the user cannot read; it does not fall back to the application (tenant) identity.
- **No file-level deletion**: it never deletes an entire table / Sheet / document / cloud file; content-level deletion requires button confirmation.
- **Injection defense**: the generic API uses a deny-by-default allowlist + hard blocking of messaging / contacts / permissions / ownership.
- **Credential protection**: AES-256-GCM within storage; the App Secret supports three tiers — plaintext / password-encrypted / proxy.
- **Outbound lockdown**: only accesses two kinds of endpoints, Feishu + the large model (code-layer allowlist + CSP, both; private deployment can be pure intranet).

See [`SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.en.md) for each item in detail.

---

## Want to package it for your own organization? (fork / self-host)

This repo's `manifest.json` `key` and `extension-key.pem` (gitignored) pin **the author's** extension ID.
When distributing your own build, please **generate your own signing key** and replace them:

```bash
# 1) Generate your own private key
openssl genrsa 2048 > my-extension-key.pem
# 2) Take its public key (base64 DER) to replace the "key" field in manifest.json
openssl rsa -in my-extension-key.pem -pubout -outform DER | openssl base64 -A
# 3) Build the .crx with your private key (see docs/enterprise/DEPLOY.md)
```

This way you have an independent extension ID and signing authority, and can roll out smooth updates yourself. **Never commit any `*.pem` / `.env.local` /
unlock passwords to the repo** (already in `.gitignore`).

---

## Documentation map

> 📖 **Full docs (offline single-page HTML, zero-dep)**: [`docs/index.html`](docs/index.html) — usage / deployment / architecture / security in one page, open it in a browser.

| Document | Contents |
|---|---|
| [`docs/index.html`](docs/index.html) | **Full doc site** (single HTML): overview / usage / deployment (personal · enterprise suite · store · private) / architecture / security / admin console / validation / FAQ |
| [`docs/QUICKSTART.md`](docs/QUICKSTART.en.md) | **Personal quick start**: configure Feishu app permissions → fill config → `npm run pack` one-click package → load & use (5 steps) |
| [`docs/STORE_PUBLISHING.md`](docs/STORE_PUBLISHING.en.md) | **Publish to the Chrome Web Store**: no-credentials public build + user bring-your-own-app setup + submission checklist + review-risk mitigations |
| [`PRIVACY.md`](PRIVACY.md) | **Privacy Policy** (bilingual): the privacy URL required for store submission, ready to host |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.en.md) | **Deployment guide**: quick start for enterprise / personal / private deployment (path selection + commands + variable cheat sheet) |
| [`docs/PRIVATE_DEPLOYMENT.md`](docs/PRIVATE_DEPLOYMENT.en.md) | **Private-deployment specific**: complete solution for intranet / private Feishu (outbound lockdown / proxy / version rollback / verification checklist) |
| [`docs/USER_GUIDE.md`](docs/USER_GUIDE.en.md) | **User guide**: full-feature walkthrough with text and images (includes screenshots) |
| [`docs/FAQ.md`](docs/FAQ.en.md) | **FAQ**: troubleshooting for authentication / export / upgrade / private deployment |
| [`CLAUDE.md`](CLAUDE.md) · [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.en.md) | **Development guide**: agent-oriented rapid iteration (loop / repo map / hard constraints / minefields) |
| [`docs/PROJECT.md`](docs/PROJECT.en.md) | **All in one**: architecture / features / security / deployment / configuration |
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.en.md) | The deep end: module structure, tool inventory, field types, API real-world pitfalls, template engine internals |
| [`SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.en.md) | Item-by-item security design audit + attack scenarios + fixes (includes App Secret / OAuth diagrams) |
| [`docs/enterprise/DEPLOY.md`](docs/enterprise/DEPLOY.en.md) | Internal enterprise distribution (.crx + force install via Chrome policy, includes macOS `.mobileconfig`) |
| [`docs/oauth-proxy/`](docs/oauth-proxy/README.en.md) · [`docs/oauth-proxy-server.mjs`](docs/oauth-proxy-server.mjs) | OAuth proxy: self-hosted Node (Docker/nginx) + Cloudflare version, secret does not enter the bundle |
| [`.env.example`](.env.example) | All build-time configuration options |
| [`CHANGELOG.md`](docs/CHANGELOG.md) | Version changelog |

---

## Contributing

Issues / PRs are welcome. Before submitting, please make sure these pass:

```bash
npm run typecheck && npm run test && npm run build
```

> If your change touches a security checkpoint (`isFileLevelDelete` / `assertApiCallAllowed` / `resolveToken` /
> `assertSafeBaseUrl`, etc.), please update [`SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.en.md) and the corresponding unit tests in sync.
> **Never commit any keys / passwords / private keys** (`.gitignore` already covers `*.pem` / `*password*.txt` / `.env.*`, etc.).

## ⚠️ Disclaimer

This tool performs real operations on your Feishu data through a large model (creating tables, writing data, deleting content, etc.). Although it has multiple built-in guardrails such as
"file-level deletion is always rejected," "content deletion requires confirmation," and "operates with the user's own privileges," **it is still recommended to use it cautiously on important data and to back up first when necessary**. Enabling "Auto mode" skips per-instance confirmation of content deletion; please be aware of the risk.
The author is not responsible for any data loss caused by using this tool (see [`LICENSE`](LICENSE) for details).

## License

[Elastic License 2.0](LICENSE) © 2026 [scott987-cmd](https://github.com/scott987-cmd) — **source-available** (not "open source" in the strict OSI sense; the same license as Elasticsearch).

In one sentence (the original text of [`LICENSE`](LICENSE) prevails): **individuals / enterprises may freely use, copy, modify, distribute, and self-deploy it (including internal commercial use within a company);
the only prohibition is "providing it as a hosted / SaaS service to third parties,"** and you may not circumvent the licensing functionality or remove copyright / license notices.

### Commercial licensing
Need a license for restricted uses such as "providing it as a hosted / SaaS service to others"?
Please **open an issue tagged `commercial` in this repo's GitHub Issues** (describing the use case and scale) to contact the author [scott987-cmd](https://github.com/scott987-cmd) to discuss.

> 🍴 Fork / redistribution: you must replace the `key` in `manifest.json` (with your own extension ID / signing private key) and change the extension ID / redirect / `ALLOW_ORIGIN` placeholders in the docs; see [`docs/DEPLOYMENT.md` §5](docs/DEPLOYMENT.en.md).
