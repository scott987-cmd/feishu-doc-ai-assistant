> 🌐 **English** | [中文](ARCHITECTURE.md)

# Architecture (Deep Reference for Modules and Internals)

> For a one-stop getting-started guide see [`docs/PROJECT.en.md`](docs/PROJECT.en.md); for a line-by-line security review see [`SECURITY_AUDIT.en.md`](SECURITY_AUDIT.en.md);
> for the full configuration reference see [`.env.example`](.env.example). This document focuses on the deep-water details: **module structure, tool inventory, field types, real-world API pitfalls,
> and the internals of the template engine**.

## Directory Structure

```
src/
├── background/
│   └── index.ts              # Service Worker — manages the side panel lifecycle
│
├── content/
│   ├── index.ts              # Injected into Feishu pages: extracts PageContext + message routing
│   └── feishu-automation.ts  # DOM automation: clicks the UI to create a dashboard, extracts block_token from the URL
│
├── sidepanel/                # React side panel UI
│   ├── main.tsx
│   ├── App.tsx               # Root component: settings loading, tab switching, context listener, session hook + drawer
│   ├── sessions/             # Multi-session management (persisted + bound per document)
│   │   ├── useSessions.ts    # hook: auto-switch session by appToken, debounced persistence, CRUD
│   │   ├── store.ts          # chrome.storage.local sharded storage (index + per-session messages)
│   │   └── logic.ts          # pure reducer: find-or-create / delete fallback (unit-testable)
│   └── components/
│       ├── ChatPanel.tsx     # Main AI conversation UI (streaming rendering, tool progress)
│       ├── ScenarioPanel.tsx # Template marketplace: Gallery → Detail → Progress → Done
│       ├── BaseContextBadge.tsx  # Base structure badge + export-template button
│       ├── Settings.tsx      # API Keys configuration + appearance (theme color)
│       ├── MessageList.tsx   # Message rendering
│       ├── InputBar.tsx      # Input box
│       ├── Skeleton.tsx      # Skeleton screens (Skeleton / TemplateCardSkeleton)
│       ├── ConfirmDialog.tsx # New-Base confirmation dialog (new / add to current / cancel)
│       ├── ChoiceDialog.tsx  # Generic option-card dialog (ask_user tool: LLM generates a question + options for the user to choose)
│       ├── SessionDrawer.tsx # Session list / switch / new / rename / delete drawer
│       └── NetworkBlocked.tsx
│
├── shared/
│   ├── ai/
│   │   ├── agent.ts          # Agent loop (streaming call + tool execution + safety checks)
│   │   ├── agent.test.ts     # Unit tests for pure safety logic (sanitizeToken / confirmation gating / truncation)
│   │   └── tools.ts          # 25 Feishu tool definitions (with destructive-tool warning markers)
│   │
│   ├── feishu/
│   │   ├── api.ts            # Bitable Base Open API (tables / fields / records / views / dashboards / transfer ownership)
│   │   ├── http.ts           # Shared request layer feishuReq (reused by sheets/docx)
│   │   ├── sheets.ts         # Spreadsheet API (create spreadsheet / sheets / cell read-write-append)
│   │   ├── docx.ts           # Docs API (create doc / read body / list blocks / insert block / delete block; buildBlock + markdownToBlocks + insertTable)
│   │   ├── compose.ts        # Composite operations (missing natively): fetchAllRecords/searchAllRecords + summarizeTable + tableToSheet + dedupeRecords + crossTableLookup + updateWhere + auditTable
│   │   ├── auth.ts           # resolveToken (uses only user_access_token) + getValidUserToken (auto-renewal) + isPermissionError
│   │   ├── appSecret.ts      # Runtime unlock of a password-encrypted App Secret (PBKDF2+AES-GCM)
│   │   ├── oauth.ts          # In-extension OAuth (launchWebAuthFlow → user_access_token → user_info)
│   │   ├── context.ts        # Base structure loading (up to 6 tables concurrently, including fields/views/options)
│   │   └── export.ts         # Base → template JSON export (IDs replaced with symbolic references)
│   │
│   ├── templates/
│   │   ├── types.ts          # ScenarioTemplate / ProgressStep / CreationResult types
│   │   ├── engine.ts         # Template execution engine (tables → views → data → dashboards)
│   │   ├── registry.ts       # Remote template fetching (HTTPS enforced) + 1h localStorage cache
│   │   ├── builtin/          # Built-in templates (E-commerce / Project Management / CRM)
│   │   └── index.ts
│   │
│   ├── providers.ts          # LLM provider presets (domestic-first: DeepSeek default / Qwen / GLM / Kimi; overseas OpenAI optional)
│   ├── theme.ts              # Accent derivation deriveAccent (single hex → full set of brand CSS variables, including dark variants)
│   ├── crypto.ts             # AES-256-GCM encryption (per-device key + auto migration)
│   ├── network.ts            # CIDR access control (WebRTC local IP detection)
│   ├── network.test.ts       # ipInCidr unit tests (/8 /24 /32 /0 + boundaries)
│   ├── config.ts             # Build-time constants (env vars → type-safe object)
│   └── types.ts              # Shared types (AppSettings / PageContext / ChatMessage)
│
└── dev/
    ├── chrome-mock.ts        # Chrome API mock in dev:ui mode (localStorage persistence)
    └── scenarios.ts          # Development scenario switching (base / nonBase / withSelection)

public/
└── templates/
    ├── index.json            # RegistryIndex — local test marketplace index
    └── hr.json               # HR management system (test template)
```

---

## Design System / Theming

- All colors / radii / shadows / gradients are centralized in `App.css`'s `:root` CSS variables (`--color-*` / `--gradient-brand` / `--shadow-*` / `--ring`); components all reference the variables → change a token to re-skin globally.
- **Dark mode**: `App.tsx` maintains `theme` (`'light'|'dark'`), writes it to `document.documentElement.dataset.theme` and persists it to `localStorage['fa-theme']`; `App.css`'s `[data-theme="dark"]` overrides tokens + a few hardcoded light fills. The moon/sun button in the header toggles it.
- The brand color is an indigo→purple gradient (`--gradient-brand`), used for the logo, titles, primary buttons, and user bubbles.
- **Accent is configurable**: `src/shared/theme.ts`'s `deriveAccent(hex,isDark)` derives a full set of brand variables from a single accent hex (primary/hover/soft/tint/border/gradient/ring + 6 `--shadow-brand-*`). `App.tsx` holds the `accent` state (localStorage `fa-accent`, symmetric with `fa-theme`), and `useEffect([accent,theme])` writes the variables to `:root`; when `accent===DEFAULT_ACCENT` it **clears** the inline overrides and falls back to the hand-tuned defaults in App.css. The "Appearance" section of Settings offers a preset palette + `<input type=color>`, which takes effect instantly without going through chrome.storage. **Note**: all brand colors have been consolidated into variables; components no longer contain hardcoded `rgba(79,107,255)`/`rgba(123,92,255)`. New UI must reference the variables, otherwise the custom accent will not take effect.
- **Skeleton screens**: `components/Skeleton.tsx` (`Skeleton` + `TemplateCardSkeleton`), with the shimmer animation in `Skeleton.css`. On ScenarioPanel's first remote fetch (`refreshing && templates===BUILTIN_TEMPLATES`), the list shows skeleton cards.
- **View transitions**: `.view-enter` (App.css `viewIn` keyframes). Tab/Settings switching is triggered in `App.tsx` via a `.app-view` keyed wrapper (`key=showSettings?'settings':tab`); each of ScenarioPanel's gallery/detail/progress/done root elements carries a `key` + `view-enter`.
- **Template cover images**: `ScenarioTemplate.cover?` (optional). If a `TemplateCard` has a cover it renders `<img class=sc-card-cover>`, with `onError` degrading back to the emoji icon; with no cover it uses the emoji directly. `hr.json`/`index.json` use inline SVG data-URIs as examples (same-origin, no CDN/CSP needed).
- Animations respect `prefers-reduced-motion`: `MessageList.css` (msg-row, etc.), `App.css` (`.view-enter`/`.skel`), and `Skeleton.css` (`.skel`) each disable them.

## Session Management (Multi-Session / Bound Per Document)

Sessions are persisted to `chrome.storage.local` and **automatically bound per document**: switching to a Feishu Base document, the side panel automatically opens the session recorded for that document; non-Base pages use the "general session".

- **Storage sharding**: `sessions_index_v1` (a lightweight index `SessionIndex`: sessions/activeId/byAppToken/generalId) + `session_msgs_v1::<id>` (per-session messages, read lazily, written with an 800ms debounce). See `sessions/store.ts`.
- **State lifted to App**: session state lives in `App`'s `useSessions(activeAppToken, streaming)` hook (not in ChatPanel — that unmounts on tab switches). `ChatPanel` becomes controlled: `messages`/`setMessages` are provided by the hook.
- **Auto switching**: the hook listens for `ctx.feishu.appToken` changes → `find-or-create` the corresponding session and loads its messages. **Switching is deferred during streaming** (follows browser navigation only after the reply completes), to avoid writing streaming chunks into a different session.
- **Title = document name**: a new document session first uses `文档 <first 8 chars of token>…` as a placeholder; once `ChatPanel`'s `fetchBaseCtx` obtains `appName`, `resolveTitle(appToken, name)` backfills it (after the user manually renames it, it is no longer overwritten).
- **Pure logic**: `sessions/logic.ts`'s `ensureSession`/`removeSession` are side-effect-free reducers (find-or-create, byAppToken maintenance, delete fallback to the current document/general session), with unit tests in `logic.test.ts`.
- **UI**: the "session bar" at the top of `ChatPanel` shows the current title and opens the `SessionDrawer` (list / switch / new / rename / delete, sorted by updatedAt, document sessions 📄, general 💬). Switching is disabled during streaming.
- **dev**: `chrome-mock.ts` adds `storage.local.remove`; storage still persists to localStorage as before, so it survives a refresh.

## Message Protocol

All messages are verified against `sender.id === chrome.runtime.id`, rejecting external sources.

```
Side Panel ──chrome.tabs.sendMessage──▶ Content Script
                                              │
         ◀──────────sendResponse─────────────┘

  GET_PAGE_CONTEXT     → PageContext { url, appToken, tableId, viewId, selectedText }
  CREATE_DASHBOARD_UI  → { blockToken: string, created: boolean } (DOM automation)

Content Script ──chrome.runtime.sendMessage──▶ Side Panel
  PAGE_CONTEXT_UPDATE  → PageContext (pushed on SPA navigation)
```

---

## AI Agent Design

### Execution Flow

```
User message
  │
  ▼
buildSystemPrompt()          # Injects role definition, scope, current Base structure
  │
  ▼
OpenAI Streaming API
  │
  ├─ text chunk → onChunk() → streaming rendering
  └─ tool_calls
       │
       ▼
  checkDestructiveConfirmation()   # Destructive tools: scans the user message for confirmation words
       │
       ▼
  sanitizeToken()                  # All ID parameters validated against the regex [A-Za-z0-9_-]
       │
       ▼
  executeTool() → Feishu API
       │
       ▼
  truncateToolResult(8KB)          # Truncate to prevent PII leakage
       │
       ▼
  Result fed back into msgs[] → next loop iteration
       │
  MAX_TOOL_CALLS=20 → stop when exceeded
```

### Interactive Dialogs (let the agent hand uncertain decisions back to the user)

There are two entry points, both relying on this mechanism: "runAgent `await`s an optional callback inside the tool loop → ChatPanel implements the dialog via `pending* state + Promise` → a button click resolves it":

1. **New-Base confirmation** — `requestConfirmation?(req): Promise<'new'|'current'|'cancel'>`. runAgent awaits before executing `create_bitable_app`, letting the user choose: create a standalone new Base / add to the current Base / cancel. Choosing "add to current" → the tool returns `{_use_current, app_token}` to guide the subsequent `create_table` to use the current app; "cancel" → `{_cancelled}`. Component: `ConfirmDialog`.
2. **ask_user generic option cards** — `askUser?(req): Promise<string>`, driven by the **`ask_user` tool**: when the LLM finds the intent unclear / information missing / multiple options need a decision, it generates a `question` + 2–4 `options` (label/description) itself and calls it. runAgent intercepts it (not via executeTool) → awaits `askUser` → passes back the user-selected label as `{user_choice}`, and the agent continues accordingly. Component: `ChoiceDialog` (reuses `ConfirmDialog.css`).

Both callbacks are **optional**: when the harness/tests don't pass them, `create_bitable_app` executes directly as "new", and `ask_user` returns `{_no_ui}` prompting the agent to ask via text instead — neither gets stuck. Rule 1.5 in the system prompt guides the agent to "use ask_user when unsure".

### Tool List (53 tools, across 3 products)

**Bitable Base (33)**
| Category | Tools |
|------|------|
| App | `get_app_info` `create_bitable_app` (created as the user, owned by the user directly, no transfer needed) |
| Tables | `list_tables` `create_table` `delete_table` ⚠️ |
| Fields | `list_fields` `create_field` `update_field` `delete_field` ⚠️ |
| Records | `list_records` `create_record` `batch_create_records` `update_record` `batch_update_records` `search_records` `delete_record` ⚠️ `batch_delete_records` ⚠️ |
| Views | `list_views` `create_view` |
| Dashboards | `list_dashboards` `copy_dashboard` (whole-dashboard copy, the only usable write operation) |
| Reports | `base_to_doc_report` (read Base structure → generate a summary doc; content generation, not export) |
| Composite (missing natively / multi-step linkage) | `summarize_table` (group aggregation / pivot → new spreadsheet) `base_table_to_sheet` (Base table → spreadsheet) `dedupe_records` ⚠️ (dedupe by key fields) `cross_table_lookup` (cross-table VLOOKUP backfill) `update_where` (conditional batch update) `audit_table` (data quality check → report) |

**Spreadsheet (13)** — `spreadsheet_token` + `range` ("{sheet_id}!A1:C10"), scope `sheets:spreadsheet`

> **Formulas (corrected from real testing)**: Feishu stores a plain `"=A2*B2"` string as **text** (not computed); a real formula must be written as `{type:'formula',text:'=...'}`. `sheets.ts`'s `normalizeCell` automatically converts strings starting with `=` into formula objects, so `write_range`/`append_rows` can pass Excel syntax directly. When reading, `read_range` uses `valueRenderOption=FormattedValue`, otherwise the default/ToString will return the formula expression ("A2*B2") instead of the computed result. The range does not accept a bare single cell (use `C2:C2`, not `C2`).
| Category | Tools |
|------|------|
| Spreadsheet | `create_spreadsheet` `get_spreadsheet` |
| Sheets | `list_sheets` `add_sheet` `delete_sheet` ⚠️ |
| Cells | `read_range` `write_range` `append_rows` `fill_column` (fill a whole column with a formula) `find_replace` `set_number_format` |
| Rows/Columns | `insert_dimension` `delete_dimension` ⚠️ |

**Docs (6)** — `document_id`, scope `docx:document`
| Category | Tools |
|------|------|
| Document | `create_document` `create_doc_from_markdown` (★ one-click Markdown → doc) `get_document_content` |
| Blocks | `list_blocks` `add_document_content` (paragraph / heading / list / quote / code / todo / divider) `insert_table` (create a table and fill content) `delete_document_blocks` ⚠️ |

> **Markdown → doc** (`docx.ts`'s `markdownToBlocks` + `createDocFromMarkdown`): parses # headings, -/* lists, 1. ordered lists, > quotes, ```code```, --- dividers, - [ ] todos, and inline `**bold**`/`*italic*`/`` `code` ``. All block type codes have been live-verified (text2 / h1-3=3-5 / bullet12 / ordered13 / code14 / quote15 / todo17 / divider22); note that the field name for a quote is `quote`, not `quote_container`.

**Base composite tools (missing natively / multi-step linkage, added 2026-05)** — all implemented in `compose.ts`: they read all records, compute locally, and write back via Feishu's batch APIs (per-batch cap 500, with `chunk` in `compose.ts` auto-batching; the read-all cap is 5000, and a `capped` flag is returned):

| Tool | Description |
|------|------|
| `dedupe_records` ⚠️ | Dedupe by the `key_fields` combination: group → keep first/last in each group → batch-delete the rest. **Destructive**; recommended to preview `duplicate_groups`/`to_delete` with `dry_run=true` first, then confirm |
| `cross_table_lookup` | Cross-table VLOOKUP: use the source-table key to match against the target table and backfill the target column into the source's `into_field` (auto-creates a text column if it doesn't exist). Multiple matches are handled per `on_multiple`=first/join/skip, returning `filled`/`unmatched`/`multi_hit` |
| `update_where` | Conditional batch update: all hits from `search_records` → write `set` to each → `batch_update`. Supports `dry_run` to preview the hit count |
| `audit_table` | Data quality check: checks `required_fields` for blanks, `unique_fields` for duplicates, and 3σ outliers in `numeric_outlier_fields`. When `output=doc`, it generates a report document via `renderAuditMarkdown`+`create_doc_from_markdown` |

> Tokens/tools of the three products cannot be mixed. Non-Base tools are dispatched in `executeTool` via `SHEET_TOOLS`/`DOC_TOOLS`, bypassing Base's `app_token` guard. `cross_table_lookup`'s `source_table_id`/`target_table_id` are not named `table_id`, so they get a dedicated `sanitizeToken` within the case.

⚠️ = destructive tool, requires explicit user confirmation to execute.

---

## Security Design

> Permission boundaries are **all hardcoded in the code** (the prompt is not a security boundary). For a line-by-line audit + attack scenarios see
> [SECURITY_AUDIT.en.md](SECURITY_AUDIT.en.md); here we only list where the code-level checkpoints land.

| Checkpoint | Location | Purpose |
|------|------|------|
| Identity = the user themselves | `auth.ts resolveToken` | Uses only user_access_token, never falls back to tenant (permissions never exceed the user's) |
| No file-level deletion | `agent.ts isFileLevelDelete` (loop + executeTool, double-checked) | Whole-table / spreadsheet / document / `feishu_api_call` DELETE are all rejected; content-level deletion goes through the confirmation gate |
| Delete/write confirmation gate | `agent.ts` destructive gate | Content deletion/writes prompt for button confirmation; **Auto mode** (`settings.autoConfirm`) auto-confirms; file-level is unaffected |
| Generic API allowlist | `agent.ts assertApiCallAllowed` | Deny by default + hard-block messaging/contacts/permissions/ownership + path traversal |
| Outbound lockdown | `config.ts isFeishuOutboundAllowed` + `providers.ts assertSafeBaseUrl` + CSP | Only allows connecting to Feishu (subdomains of the base domain) + the LLM; private deployment can be intranet-only |
| Context source | `App.tsx onMessage` | Only accepts PAGE_CONTEXT_UPDATE from the **active tab of the current window** (prevents cross-talk from background tabs) |
| Tool-call cap | `agent.ts` | Default 30 per turn (configurable via `VITE_MAX_TOOL_CALLS`); when the cap is hit, it stops and asks the user to confirm continuing |
| Credential encryption | `crypto.ts` | AES-256-GCM, key = PBKDF2(extension ID + per-device random seed); encrypts token/secret |
| App Secret | `appSecret.ts` | Three tiers: plaintext / password-encrypted (PBKDF2→AES-GCM) / proxy |
| Data minimization | `agent.ts truncateToolResult` | Tool results passed to the LLM are truncated to 8KB, preventing bulk PII leakage |

---

## Template System

### Marketplace Architecture

```
Build-time injection of VITE_DEFAULT_REGISTRY_URL
  │  effectiveUrl = settings.templateRegistryUrl || DEFAULT_REGISTRY
  ▼
registry.ts
  ├─ Validate URL (HTTPS or relative path)
  ├─ fetch {url}/index.json → RegistryIndex
  ├─ Concurrently fetch each template.json
  └─ localStorage cache 1h
  │
  ▼
mergeTemplates()             # Remote entries with the same id override built-ins
  │
  ▼
ScenarioPanel Gallery        # Template marketplace UI (one-click import)
```

### URL Priority

| Priority | Source |
|--------|------|
| 1 (highest) | Address entered by the user in Settings |
| 2 | Build-time `VITE_DEFAULT_REGISTRY_URL` |
| 3 | No remote; show only built-in templates |

### Symbolic References

The template JSON uses symbols in place of real IDs, which the engine resolves after creating tables:

```
"__tbl:{ref}__"              → real table_id
"__fld:{tableRef}:{name}__"  → real field_id
```

### Template Execution Order

1. Create / reuse the App
2. Create tables in order
   - Create non-formula fields first
   - Then create formula fields (which depend on other fields existing)
   - List field IDs and build `fieldIdMaps` (used for dashboard symbol resolution)
3. Create views
4. Bulk import sample data
5. Configure dashboards

### The Real Boundaries of Dashboard Capabilities (corrected from real testing, 2026-05)

⚠️ **Earlier docs overestimated the API's capabilities. In practice, Feishu's bitable OpenAPI has only two dashboard endpoints:**

| Operation | Endpoint | Reality |
|------|------|------|
| List dashboards | `GET .../dashboards` | ✅ Real (returns name + block_id) |
| Copy a dashboard | `POST .../dashboards/{id}/copy` | ✅ Real (returns 91403, not 404, when lacking write permission) |
| Read chart blocks | `GET .../dashboards/{id}/blocks` | ❌ **404, does not exist** |
| Create chart blocks | `POST .../dashboards/{id}/blocks` | ❌ **404, does not exist** |

**Consequences**: `api.ts`'s `getDashboardBlocks` / `createDashboardBlock` calls always 404, and they are silently swallowed by `catch` at `engine.ts:248` and `export.ts:151` — so:
- The template engine has never actually created any charts (the `dash.blocks` loop fails every time, it just doesn't error);
- When exporting a template, a dashboard's `blocks` is always `[]` (unreadable).

**The correct path**: programmatically "creating charts one by one" is impossible. To replicate a dashboard you can only use **`copyDashboard` to copy the whole dashboard** (requires edit access to the Base), or go through **DOM automation** (browser-only, available while the user is on that Base page).

> TODO (needs a decision, will change the template format): switch the template engine/export from the "block config" mode to a "copy source dashboard" mode, and remove the call sites of the two dead 404 functions.

---

## AI Mini-Apps / Data Apps (Sandboxed Mini-Apps)

Turn the data of the current Bitable/Spreadsheet, with a single sentence (or conversation), into a floating-window **mini-app** on the Feishu page — the same codegen+sandbox pipeline produces five kinds:
**chart dashboards** (ECharts) · **calculators / interactive tools** · **printable reports** (`window.print()`) · **presentation slides** · **custom views like card walls / timelines**.
They are distinguished purely by the prompt (same runtime globals: `data / echarts / container / theme`). What is generated is **read-only rendering** code — it never writes to Feishu (writing tables is left to Smart Fill / conversation tools).

**Data flow (4 contexts)**

```
Side panel (has chrome.*/token/LLM key)
  generateViz() one-shot codegen → {name, code}          // generate mini-app code
  fetchVizData() listRecords/readRange → {schema, rows} // fetch live data
  chrome.tabs.sendMessage(tabId, {DATAVIZ_RENDER, vizId, code, data})
  ↓
Content script (*.feishu.cn): injects a draggable/corner-resizable floating window + sandbox iframe; multiple instances by vizId;
  iframe.postMessage({code,data,nonce}); responds RENDER_OK/ERR → relays back to the side panel
  ↓
Sandbox page (src/sandbox, MV3 sandbox.pages): null origin, no chrome.*, connect-src 'none';
  bundles ECharts (treeshaken, this package only); executes generated code via new Function to render
```

- **Code and data are separated**: what's saved is the `render(data,echarts,container,theme)` code (`SavedViz`, stored in `chrome.storage.local`);
  the data is **re-fetched live** every time. So reopening "My Mini-Apps" = fetch fresh data + run the old code, **zero LLM, data always up to date**.
- **Triggers**: the "🧩 AI Mini-App" button in the scenario hub + the conversation tool `render_data_app`; **adjustment = minimal edit to the current code** — the existing code is passed back to the model, which only changes the one spot the user named and keeps the other charts verbatim (in a multi-chart dashboard it won't "rearrange the whole board to change one chart").
- **Multiple instances**: a single page can host multiple independent mini-apps (each with its own floating marker, its own floating window, openable simultaneously); a single dashboard can contain multiple charts (CSS Grid, multiple echarts instances).

**Security**: what's generated is LLM code, but it runs in a locked-down sandbox — `connect-src 'none'` (**even with the data, it can't be sent out**), null origin (**no token/storage/chrome.* access**),
cross-origin isolated from the Feishu page DOM; codegen goes through the existing LLM endpoint (no new outbound); plus a static rejection of `fetch|import|WebSocket` as a backstop. The sandbox **renders read-only and never writes back to Feishu**. See "M9" in SECURITY_AUDIT.

**Capacity (observed magnitudes, not hard limits)**

| | Magnitude | Notes |
|---|---|---|
| **Saved dashboards** | Hundreds | Stores only code+binding (~5–20KB each), constrained by `chrome.storage.local` (~10MB), practically unlimited |
| **Floating windows open at once** | ~5–10 comfortable | Each is an independent sandbox iframe (each carrying a copy of the ECharts runtime + canvas, ~10–20MB each) → **RAM-bound**, not a hard limit |
| **Small charts within a single dashboard** | 4–9 optimal, ~12 still OK | Each `echarts.init` is one canvas; more than that crowds the window and degrades performance |
| **Floating markers** | Dozens, no problem | Pure DOM buttons |

> Key point: **dashboards that aren't open consume almost no resources** (just stored code); what truly eats memory is "having several floating windows open at once". For more savings, only open what you're currently viewing and close it when done.

---

## AI Smart Fill

In a **Bitable / Spreadsheet**, select a column, and AI infers the **missing** values of that column by referencing the other columns of the same row (+ already-filled rows as examples), previews them, then writes them back. What's returned is **structured values** (not code), so the whole process happens **locally in the side panel** — no sandbox, no content script, no background relay.

**Data flow (all side-panel-local)**
```
Read: fetchFillContext(source) —— Base: listFields (type/options) + fetchAllRecords (with record_id, deduped by id)
                                Sheet: readRange (header = field, row number = write key, all columns treated as text)
     Split rows by the target column into "missing = to fill" / "filled = examples"
Infer: send to the LLM in batches (~40 rows each) —— schema+options + K examples + rows to fill (each with a stable key)
     → inferFills() parses {fills:[{key,value}]} → Map<key, raw value>
Validate: coerceValue() coerces by field type —— single-select/multi-select must hit an existing option (otherwise skipped, never created);
     number/date parse failure → skip; key→write key (record_id / row number) mapped locally (the model never sees the write key, never relies on order)
Preview: assemble FillPlan (proposed[] + skipped[]) and render —— this step never writes
Apply: applyPlan() → resolveToken, branched by source:
     Base  → batchUpdateRecords (batches of 500, deduped by record_id, **counted from the actual data.records**, no over-reporting)
     Sheet → re-read the target column range → overwrite only cells still blank → writeRange in one write-back (never touches other cells)
     update only, as the user, only touches the current table/sheet
```

- **Fill blanks only** (default): the `Overwrite existing values` toggle is off by default; blank detection uses `cellToString().trim()===''` (consistent with `auditTable`).
- **Accurate counting**: the Base write count comes from Feishu's returned `data.records` (Feishu may return code 0 but only apply part of it); if fewer than requested, it reports "N cells not written" truthfully, and previewing again fills the rest.
- **Fillable types**: Base text/number/single-select/multi-select/date/checkbox/phone/link (formula/lookup/auto-number/link/attachment/person/system fields excluded); Sheet columns are all treated as text.
- **Large tables**: a single preview's inferred cap is ~300 rows; after applying, previewing again continues filling the rest; the read cap is 5000.
- **Comparison with AI Mini-Apps**: mini-apps must lock the **generated code** into a sandbox to execute (executing untrusted code is the threat); Smart Fill produces only **values**,
  and the write-back goes through the very same compliant write path as `updateWhere`/`crossTableLookup`, so the entire sandbox/relay layer is unnecessary. See "M11" in SECURITY_AUDIT.

---

## Authentication and Identity Model (Security Core)

> Early versions created with the application (tenant) identity, then transferred ownership to the user. **It has now been changed so the assistant always operates as the user's own
> `user_access_token`**, never using the tenant identity. This satisfies three fundamental principles at once — see them one by one in
> "0. Core Operation Policy" of [SECURITY_AUDIT.en.md](SECURITY_AUDIT.en.md).

- **P1 creations belong to the user**: creating as the user → new documents **belong to the user directly**, no transfer needed.
- **P3 permissions never exceed the user's**: `auth.ts resolveToken()` **returns only user_access_token** (no tenant branch);
  what the user can't read, the assistant can't read either; permission errors are reported truthfully, with no tenant fallback.
- **OAuth auto-renewal**: Settings "Authorize with Feishu account" → `oauth.ts` goes through `chrome.identity.launchWebAuthFlow`
  (the manifest `identity` permission) → `authen/v2/oauth/token` exchanges for user_access_token + refresh_token
  (stored encrypted, auto-renewed 5 minutes before expiry, see `getValidUserToken`) → `user_info` obtains open_id.
- **Redirect URL**: `chrome.identity.getRedirectURL()` = `https://<ext-id>.chromiumapp.org/`,
  registered under the app's "Security Settings → Redirect URL".
- **App Secret three tiers** (pick one at build time): plaintext `VITE_FEISHU_APP_SECRET` (bundled) / password-encrypted
  `VITE_FEISHU_APP_SECRET_ENC` (generated by `scripts/encrypt-secret.mjs`, unlocked at runtime with a password) /
  OAuth proxy `VITE_OAUTH_PROXY_URL` (the secret is not bundled, see `docs/oauth-proxy-worker.js`).

## Field Type Quick Reference

| type | Name | type | Name |
|------|------|------|------|
| 1 | Text | 13 | Phone |
| 2 | Number | 15 | URL |
| 3 | Single select | 17 | Attachment |
| 4 | Multi select | 20 | Formula |
| 5 | Date (Unix ms) | **1005** | **Auto number** |
| 7 | Checkbox | 1001–1004 | System fields (read-only) |
| 11 | Person | 18/19/21 | One-way link / lookup / two-way link (needs property, not yet supported by templates) |

> ⚠️ **Auto number is `1005`, not `21`** (21 is the two-way link DuplexLink). The early `api.ts` enum once mislabeled 21 as AutoNumber, causing the hr template's "工号" (employee ID) field to fail on table creation with `code=800074092 DuplexLink field property is null`; this has been fixed. Link/lookup types (18/19/21) require `property` pointing to the target table, and the engine skips such fields when they lack a property.

> **Formula fields (type=20)**: pass `formula_expression` on the field object, writing the expression directly using the **exact names of the referenced fields** (e.g. `数量*单价`). ⚠️ You must use field names, not `CurrentValue.[…]` or field IDs (in practice that creates an empty formula with null record values). When creating a table, place formula fields after the fields they depend on. Both the `create_field` and `create_table` tools expose this parameter.

---

## Environment Variables Summary

For all build-time variables (across the three deployments: personal / enterprise SaaS / private) see [`.env.example`](.env.example)
and [`docs/PROJECT.en.md`](docs/PROJECT.en.md) §9 — including the App Secret three tiers, the OAuth proxy, the private-deployment base domain,
the LLM host allowlist, the device CIDR gate, the tool-call cap, and more.

---

## Development Guide

### Debugging the UI (no need to load the extension)

```bash
npm run dev:ui
# Open http://localhost:5173/dev.html
# In the browser console you can use scenarios.base() / scenarios.nonBase() to switch scenarios
```

### Debugging the Extension

```bash
npm run dev:ext
# Load dist/ at chrome://extensions; code changes auto-reload
```

### Adding a Template

1. Create `{name}.json` in `public/templates/` (following the `ScenarioTemplate` type)
2. Add an entry to `templates[]` in `public/templates/index.json`
3. Run `npm run build`, then reload the extension

### Modifying Agent Tools

- Adding a tool: add the definition in `tools.ts` + add a case in `agent.ts` `executeTool()`
- Destructive tools: prefix the description with `⚠️` and add it to the `DESTRUCTIVE_TOOLS` Set (currently: `delete_table` / `delete_field` / `delete_record` / `batch_delete_records` / `delete_sheet` / `delete_dimension` / `delete_document_blocks` / `dedupe_records`)
- Name all ID parameters `app_token` / `table_id` / `field_id` / `record_id` to trigger `sanitizeToken`'s automatic validation

> `update_field`: Feishu's update-field API requires the body to carry both `field_name` and `type`, while the LLM usually only passes the changed fields. `executeTool` first does a `list_fields` to fetch the current field, backfills the missing `field_name`/`type`, then calls the API, avoiding a 400.

### Testing

```bash
npm run typecheck    # tsc --noEmit (the build uses esbuild and does no type checking; type regressions are caught by this step)
npm run test         # vitest run — covers pure safety logic
```

Test scope (pure functions, no Chrome/network needed):
- `network.test.ts` — `ipInCidr` CIDR matching (including `/0`, `/32`, and the unsigned-bit issue at the top of the address space)
- `agent.test.ts` — `sanitizeToken` (injection-character blocking), `checkDestructiveConfirmation` (exact confirmation-word gating), `truncateToolResult` (PII truncation)

Live integration tests (hit the real Feishu API, skipped by default):
- `feishu/live.test.ts` — runs create_table / update_field backfill / delete_table / batch record read-write through `executeTool`
- Requires the app to have `bitable:app` (application identity); credentials are read from `feishu-app-config.txt`
- Run: `FEISHU_LIVE=1 npx vitest run src/shared/feishu/live.test.ts`
- Self-check anytime whether permissions take effect: `node scripts/check-perm.mjs`

Template replication harness (end-to-end run against a real Agent: DeepSeek + Feishu API, skipped by default):
- `harness/` — drives `runAgent` with natural language, replicates Bitable templates and verifies fields/types
  - `driver.ts` — headless driver (mints tenant token, injects DeepSeek settings, reads back the structure)
  - `templates.ts` — 10 template specs across different domains (NL prompt + expected fields)
  - `replicate.test.ts` — runs all 10 and scores them, writing the report to `harness-report.txt`
  - `rich.test.ts` — hardcore replication probe (formula fields + sample data + dashboard views)
- LLM config is read from `deepseek-v4-pro.txt` (base_url / api_key); the model defaults to `deepseek-v4-pro`, overridable with `LLM_MODEL`
- Run: `REPLICATE_LIVE=1 npx vitest run src/harness/replicate.test.ts`
- Measured result: 10/10 templates with 100% field coverage; the hardcore probe verifies that formula fields actually compute
