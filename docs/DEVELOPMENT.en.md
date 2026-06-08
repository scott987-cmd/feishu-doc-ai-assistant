> 🌐 **English** | [中文](DEVELOPMENT.md)

# Development Handbook (a fast-iteration guide for AI agents)

> Goal: enable a **newly onboarded agent** to safely change code, validate it, and avoid breaking existing constraints — within minutes.
> For the deep-end structure, see [`../ARCHITECTURE.en.md`](../ARCHITECTURE.en.md); for a one-stop overview, see [`PROJECT.en.md`](PROJECT.en.md);
> for the security checklist item by item, see [`../SECURITY_AUDIT.en.md`](../SECURITY_AUDIT.en.md); for deployment, see [`DEPLOYMENT.en.md`](DEPLOYMENT.en.md).

---

## 0. What is this

A Chrome **MV3** extension, "Feishu Doc AI Assistant": on Feishu Base / Sheet / Doc pages, it lets the AI operate via natural language and can turn data into websites / dashboards / PPTs. **No backend** — everything runs under **the user's own Feishu identity**. Tech stack: React 18 + TS + Vite + vitest + ECharts.

---

## 1. The iteration loop (most important — follow this)

```bash
npm install                 # first time
# —— edit the code under src/ ——
npm run typecheck           # ① must be 0 errors (tsc --noEmit)
npm test                    # ② must be all green (vitest, ~355 cases); new logic needs new tests
npm run build               # ③ must succeed (occasional TLS error → just retry, it's network jitter from the manifest plugin)
npm run test:ui             # ④ only needed if you changed the side-panel UI (puppeteer smoke, 11 items)
# Real-device check: chrome://extensions → Developer mode → Load dist/ → open the side panel on a Feishu page
```

**Definition of "done"**: ①②③ all pass (add ④ if you touched the UI). **Do not** say it's done while typecheck/test are not passing.

Preview does not require a real extension: `npm run dev:ui` (uses `src/dev/chrome-mock.ts` to mock `chrome.*`, view the side panel directly in the browser).

---

## 2. Repo map (where to find things)

| Path | Responsibility |
|---|---|
| `src/sidepanel/` | React side-panel UI. `components/*Panel.tsx` are the feature panels; `App.tsx` is the top level + auth banner |
| `src/background/` | Service Worker: message routing, `RESOLVE_PAGE_RESOURCE` (wiki → real resource), clipping/screenshots, write-back bridge |
| `src/content/` | Content scripts injected into Feishu pages. `viz-overlay.ts` = draggable floating window (hosts the sandbox iframe); page-context detection |
| `src/sandbox/` | **Sandbox iframe** (opaque origin, `connect-src:'none'`). `main.ts` runs the LLM-generated visualization/site-building/PPT code; `index.html` contains the design-system CSS + ECharts |
| `src/shared/ai/` | `agent.ts` (the ~50-tool tool-calling main loop, 1.3k lines), `llm.ts`, `slides.ts`, `dataviz.ts`, `docaudit/summary.ts`, `*Store.ts`, `recipes.ts` |
| `src/shared/feishu/` | `api.ts` (bitable), `sheets.ts`, `docx.ts`, `http.ts` (`feishuReq`/`feishuFetch`), `auth.ts` (token lifecycle), `oauth.ts`, `appSecret.ts`, `version.ts` (private-deployment version fallback), `pageUrl.ts` |
| `src/shared/dataviz/` | `store.ts` (saved dashboards/sites, `dataviz_v1`), `scope.ts` (attribution to the current table), `send.ts`, `data.ts` |
| `src/shared/` | `config.ts` (all `VITE_*` → `BUILD_CONFIG`), `crypto.ts` (device encryption), `theme.ts` (color scheme), `types.ts` |
| `src/shared/{templates,smartfill,report,clip}/` | template library / smart fill / data reports / web clipping |
| `scripts/` | `ui-smoke.mjs`, `capture-screenshots.mjs`, `encrypt-secret.mjs`, `check-perm.mjs` |
| `vite.config.ts` | production build + `transformManifest` (CSP/host_permissions/sandbox are all generated here per env) |

---

## 3. Data flow (one diagram)

```
side panel (React) ──message──▶ background SW ──▶ Feishu OpenAPI (user token)
     │                                  ▲
     │ generated code {code,data}       │ feishuReq/feishuFetch (outbound guard + retry + version fallback)
     ▼                                  │
content script viz-overlay ──▶ sandbox iframe (runs generated code, connect-src:none, only returns {ok/err}/write-back draft)
```
- The sandbox **only** receives `{code,data}` and returns `{ok/err}`; it cannot access `chrome.*`/token.
- Cross-frame messages are validated with nonce/source (see the message listeners in `viz-overlay.ts` and `sandbox/main.ts`).

---

## 4. Hard constraints (**must read before changing — do not break**)

These are **security boundaries hardcoded in the code**; prompts don't count. If a change touches them, you must preserve the semantics and add tests:

1. **Always act as the user**: `auth.ts resolveToken` only returns a user_access_token and **never falls back to tenant**.
2. **File-level deletes are always rejected**: `agent.ts isFileLevelDelete` (`delete_table`/`delete_sheet`/any `feishu_api_call` DELETE) double-blocks them. Content-level deletes (rows/fields/blocks/dedup) go into `DESTRUCTIVE_TOOLS` and only execute after the **confirmation gate**.
3. **Generic API allowlist + hard bans**: `assertApiCallAllowed`/`API_BLOCKED` block messaging (`im`)/contacts/permissions/ownership/path traversal.
4. **Outbound lockdown**: all Feishu requests go through `feishuReq`/`feishuFetch` (the `isFeishuOutboundAllowed` guard); the LLM is restricted by `assertSafeBaseUrl`. Don't bypass them with a direct `fetch`.
5. **Sandbox isolation**: generated code runs at an opaque origin + `connect-src:'none'`. **Do not** add `allow-same-origin` to the sandbox or open up connect-src.
6. **Secret never ships in plaintext**: direct connection uses a password-encrypted secret (`appSecretEnc`) or a proxy (`oauthProxyUrl`); plaintext `VITE_FEISHU_APP_SECRET` is for local debugging only.
7. **Write operations are not auto-retried**: `http.ts robustFetch` sends POST/PUT/PATCH/DELETE only once (a creation that timed out may have already succeeded).

> When changing these areas, the top of README also warns: changes touching `isFileLevelDelete`/`assertApiCallAllowed`/`resolveToken` need extra care and an accompanying harness.

---

## 5. Common changes (recipes)

- **Add an AI tool**: add the schema to the tool-definitions array in `agent.ts` + add a branch in `executeTool`; depending on its nature, add it to `DESTRUCTIVE_TOOLS`/`WRITE_TOOLS`/`FILE_LEVEL_DELETE_TOOLS`/`CREATE_ONCE_TOOLS`; add to `agent.test.ts`.
- **Add a Feishu API**: write a wrapper in `api.ts`/`sheets.ts`/`docx.ts`, and you **must** use `feishuReq`/`req` (which bring the outbound guard + version fallback). Write the path for the current SaaS version (e.g. `/bitable/v1/...`); private-deployment fallback is handled automatically.
- **Add a side-panel panel**: create `XxxPanel.tsx` under `src/sidepanel/components/`, mount it into `ScenarioPanel.tsx` (grouped by `requires: 'table'|'doc'|'any'|'content'`, context-aware). Generation-type panels must handle busy/cancel/cache restore/`isTokenExpiredError` error copy.
- **Change sandbox rendering (dashboard/site/PPT)**: the logic is in `sandbox/main.ts` (`ui.*` helpers, `render()`, message listener); the styles are in the design-system CSS of `sandbox/index.html`. The floating-window chrome (🖨/🎨/✕/submit) is in `content/viz-overlay.ts`.
- **Change colors/theme**: `shared/theme.ts` (`deriveAccent` for the side panel, `vizAccent` for the sandbox).
- **Add a build config**: read `import.meta.env.VITE_XXX` in `config.ts BUILD_CONFIG`, and document it in `.env.example`; if it affects CSP/host, edit `vite.config.ts`.

---

## 6. Minefields (pits we've stepped in before — suspect these first)

| Symptom | Real cause / fix |
|---|---|
| Export PDF (🖨) does nothing | the sandbox needs `allow-modals`, and **both layers are required**: the iframe attribute in `viz-overlay.ts` + the CSP `sandbox` directive in `vite.config.ts` (they're intersected). |
| token expires after ~2h (`99991677`) | OAuth must include `offline_access` to be issued a refresh_token. `oauth.ts` already **forces** the request; don't remove it when changing auth logic. |
| a private-deployment endpoint returns 404 | `feishuFetch`'s `/vN/` → `v(N-1)` fallback (`version.ts`), effective only under `IS_PRIVATE_DEPLOY`. |
| an env var has no effect | **Vite only reads `VITE_*` from `.env` files, not `process.env`**. For multiple config sets, use `.env.<mode>.local` + `vite build --mode <mode>`. |
| `npm run build` occasionally throws a TLS error | network jitter from the manifest plugin — **just retry**. |
| duplicate write operations (created two tables) | don't add retries to write methods (`robustFetch` deliberately only retries GET). |
| echarts not showing in the sandbox / missing chart when printing | the container must have a real size before `init`; printing goes through `@media print` + a one-chart-per-page stack (see `index.html`/`main.ts` slidesPrint). |
| dev:ui crashes with `chrome.X is not a function` | `src/dev/chrome-mock.ts` is missing the corresponding API — fill in the mock. |
| changed the brand name/copy and ui-smoke breaks | `scripts/ui-smoke.mjs` has assertions (e.g. the brand name) — update them in sync. |

---

## 7. Testing conventions

- Pure logic (`version.ts`/`scope.ts`/`crypto`, etc.): `*.test.ts` unit tests, **preferred**.
- Things needing chrome/config: inject via `vi.mock('../config', ...)` (see `http.version.test.ts` forcing `IS_PRIVATE_DEPLOY`).
- UI: `MessageList.test.tsx` etc. use jsdom + testing-library; full rendering uses `npm run test:ui`.
- Visual (sandbox rendering/printing/colors): use puppeteer + `page.emulateMediaType('print')`/screenshots, validated with throwaway scripts (refer to the `_print_diag`/`_accent_shot` patterns in the session).
- Feishu live test: `FEISHU_LIVE=1 npx vitest run src/shared/feishu/live.test.ts` (requires `feishu-app-config.txt`).

---

## 8. Config and secrets (cheat sheet)

- All build variables are in [`../.env.example`](../.env.example); at runtime they're read from `config.ts BUILD_CONFIG`.
- Key derivations: `HAS_BUILTIN_CREDS`, `HAS_ENCRYPTED_SECRET`, `IS_PRIVATE_DEPLOY`, `FEISHU_API_BASE`, `OAUTH_PROXY_HOST`.
- Persistence all lives in `chrome.storage.local`, with keys carrying `_v1` (no data loss on update; remember to migrate when changing the schema — don't bump to `_v2` bare).
- secret: `encrypt-secret.mjs` generates the ciphertext → `VITE_FEISHU_APP_SECRET_ENC`; decryption is in `appSecret.ts` (PBKDF2 210k → AES-GCM).

---

## 9. Where to look first when something breaks

| Symptom | Look first at |
|---|---|
| auth/401/renewal | `feishu/auth.ts` + `oauth.ts` (does the scope include offline_access?) |
| a Feishu call failed | `feishu/http.ts` (outbound guard / version fallback) + the corresponding `api/sheets/docx.ts` wrapper |
| tool behavior / confirmation gate | `ai/agent.ts` (tool set, `executeTool`, the `*_TOOLS` sets) |
| dashboard/site/PPT rendering or export | `sandbox/main.ts` + `sandbox/index.html` + `content/viz-overlay.ts` |
| panel/grouping/context | `sidepanel/components/ScenarioPanel.tsx` + the various `*Panel.tsx` |
| CSP/permissions/host | `vite.config.ts transformManifest` + the built `dist/manifest.json` |

---

## 10. Pre-commit self-check checklist

- [ ] `npm run typecheck` 0 errors
- [ ] `npm test` all green (new logic has tests)
- [ ] `npm run build` succeeds
- [ ] touched the UI: `npm run test:ui` 11/11
- [ ] did not touch/weaken the hard constraints in section 4 (if touched, tests added + called out in the PR/notes)
- [ ] touched copy/brand: updated the `ui-smoke.mjs` assertions and the related docs in sync
