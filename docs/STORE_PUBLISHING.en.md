> 🌐 **English** | [中文](STORE_PUBLISHING.md)

# Publishing to the Chrome Web Store (Public Edition)

The core principle of public distribution: **no credentials are bundled inside the extension package**. Each user fills in their own Feishu App ID + Secret (stored encrypted on their own machine).
This document covers: ① how to build the public edition → ② how a user configures it on first run → ③ the publishing checklist (item by item) → ④ review risks and how to avoid them → ⑤ the update flow.

---

## 1. Building the Public Edition (zero-credential, no-`key` package)

A store package has two hard requirements: **① no baked credentials** and **② no `key` field in the manifest** (the store assigns the ID; a `key` triggers the "Manifest must not include 'key'" upload error).

Use a dedicated `.env.store.local` (gitignored; leaves your `.env.local` untouched):
```bash
cat > .env.store.local <<'E'
VITE_FEISHU_APP_ID=
VITE_FEISHU_APP_SECRET=
VITE_FEISHU_APP_SECRET_ENC=
VITE_OAUTH_PROXY_URL=
VITE_WEBSTORE=1
E
npx vite build --mode store          # zero credentials + auto-strips manifest.key
cd dist && zip -qr ../feishu-doc-ai-assistant-store.zip . && cd ..
```
> `VITE_WEBSTORE=1` makes the build delete `manifest.key`; `--mode store` makes Vite read `.env.store.local` (its empty values override the credentials in `.env.local`).

Self-check — **no secret in the package, no key in the manifest**:
```bash
grep -riE "cli_[a-z0-9]{16}" dist/ ; echo "↑ should be empty (no App ID)"
grep -o '"key"' dist/manifest.json ; echo "↑ should be empty (no key field)"
```
Upload `feishu-doc-ai-assistant-store.zip` to the Chrome developer console.

> The Store edition automatically enters "bring-your-own-app" mode: a "self-built Feishu app" input area appears in Settings, where users enter their own App ID/Secret.
> Once the `key` is removed, the store assigns the extension ID → the OAuth redirect URL changes accordingly, but the Settings page **displays the current real redirect URL at runtime**, so users just register that.

**Store title/summary = the package's `manifest.name`/`description` (not editable in the console)**, and the default name "飞书文档AI助手" reads as an official Feishu product (trademark risk). So `VITE_WEBSTORE=1` **automatically** swaps in a compliant third-party name/summary:
- Name: `AI 助手 for 飞书 · 表格/文档/电子表格（第三方）`
- Summary: `第三方开源工具……与飞书无官方关联。`
- To customize, set `VITE_STORE_NAME=` / `VITE_STORE_DESC=` in `.env.store.local` (summary ≤132 chars).
- The icon is now an original AI sparkle (no letter, not Feishu blue), free of any Feishu/brand elements.

---

## 2. User First-Time Configuration (write this into your store description/help)

After installing, the user needs to do a one-time setup:
1. Go to [open.feishu.cn](https://open.feishu.cn) and create an **enterprise self-built app** to obtain an **App ID / App Secret**.
2. Under the app's "Permission Management", enable (all checked as **user identity**): `offline_access` (required) + as needed `bitable:app` `docx:document` `sheets:spreadsheet` `drive:drive` `wiki:wiki` `contact:user.base:readonly`.
3. Under "Security Settings → Redirect URL", fill in the callback address shown in the extension (the settings page displays it automatically, in the form `https://<extension-ID>.chromiumapp.org/`).
4. Add yourself to the "availability scope" and **publish**.
5. Back in the extension → Settings → **Self-built Feishu app**, enter the App ID + Secret → Save → **Authorize with your Feishu account** → enter the LLM Key → start using it.

> See [`QUICKSTART.md`](QUICKSTART.en.md) for details. The redirect URL must be an **exact match** (including the trailing slash).

---

## 3. Chrome Web Store Publishing Checklist

### 3.1 Account and Basics
- [ ] Register a **Chrome developer account** (one-time $5): https://chrome.google.com/webstore/devconsole
- [ ] `manifest.json` has complete `name` / `description` / `version` / icons (16/32/48/128) ✅ (this project already has them)
- [ ] Upload the zip (compressed `dist/`)

### 3.2 Privacy and Data (the part that most easily gets stuck)
- [ ] **Privacy policy URL** (required): use this repo's [`PRIVACY.md`](../PRIVACY.md), hosted as an accessible URL, for example
      `https://github.com/scott987-cmd/feishu-doc-ai-assistant/blob/main/PRIVACY.md`, and fill it into the "Privacy" page of the developer console.
- [ ] **Single purpose statement**: fill in "An AI assistant for operating Feishu Base/Doc/Sheet with natural language".
- [ ] **Data usage declaration** (check each item in the developer console):
      - Data processed: website content (Feishu page content), user activity (your commands), authentication information (OAuth token).
      - Check: **not sold/not transferred to third parties**; **not used for unrelated purposes**; **not used for creditworthiness determination**.
      - Critically, declare truthfully: data is only sent to the Feishu and LLM **configured by the user themselves**; the author does not collect it.
- [ ] **Per-permission justifications** ("why it's needed", fill in these items):

| Permission | Justification (ready to use) |
|---|---|
| `identity` | Uses Feishu OAuth to obtain the user's own user_access_token (user identity only) |
| `storage` | Stores the user's credentials and settings encrypted on their machine |
| `sidePanel` | Provides the side panel main interface |
| `scripting` + `activeTab` + host `*.feishu.cn` | Injects the side panel into Feishu pages and reads the current page context to execute user commands |
| `contextMenus` | Right-click "Clip to Feishu" entry |
| `commands` | Keyboard shortcut to trigger clipping |
| host_permissions `https://*.feishu.cn/*` | Limited to Feishu domains only; the extension works only on Feishu pages |

### 3.3 Listing Information
- [ ] **Title**: see the trademark note in §4.3 (don't let people mistake it for official Feishu).
- [ ] **Short description** (≤132 characters).
- [ ] **Detailed description**: you can copy the feature highlights straight from the README.
- [ ] **Category**: Productivity / Office.
- [ ] **Language**: Chinese (Simplified); English can be added.
- [ ] **Screenshots**: 1–5, **1280×800**, **24-bit PNG with no alpha**. Ready-made: `npm run screenshots:store` → `docs/store-screenshots/store{1..5}.png` (caption + UI pre-composed to spec, upload directly).
- [ ] **Small promo tile** (optional): 440×280 · 24-bit PNG no alpha. Ready-made: `npm run promo` → `docs/store-screenshots/promo-440x280.png`.
- [ ] **Promo video** (optional but strongly recommended): fill in your YouTube link `https://youtu.be/JhPNeOK1n8g`.
- [ ] **Store icon** 128×128 ✅.

---

## 4. Review Risks and How to Avoid Them (key section — these items are most likely to be rejected)

### 4.1 ⚠️ Trademark / "official" misleading (frequent rejection reason)
"Feishu" is a ByteDance trademark. The store will reject extensions that **make people mistake them for official**.
- **Rename it**: don't use a plain "Feishu Doc AI Assistant" that implies it's official; use a clear third-party name, such as **"AI Assistant for Feishu (Unofficial)"** or **"Feishu Base AI Assistant · Third-party"**.
- Add a line in the description: **"This extension is a third-party open-source tool with no official affiliation with Feishu / ByteDance."**

### 4.2 ⚠️ Remote code / dynamic execution (MV3 focus)
The extension uses a sandbox to run **LLM-generated JS** (`unsafe-eval`). MV3 prohibits "remotely hosted code". Mitigation notes (state these clearly in the review remarks):
- The code is **not a script loaded from a remote server**, but text returned by the LLM, rendered locally inside an **isolated sandbox iframe** (opaque origin);
- That sandbox is **`connect-src 'none'`**, with **no network egress at all** — the generated code can neither obtain nor send out data;
- The extension's own logic is all bundled locally and does not fetch and execute remote scripts at runtime.
> This is the most likely point to be questioned; explain it proactively up front in the "submission notes / review remarks", and attach the `SECURITY_AUDIT.md` link.

### 4.3 ⚠️ Broad `connect-src https:`
To support users **filling in any LLM address themselves**, the extension page's CSP `connect-src` includes the `https:` wildcard. Explanation: this is to let users connect to the OpenAI-compatible service **of their own choosing**, not to connect to the author's server; data is only sent to the endpoint the user configures.

### 4.4 Permission Minimization
- It no longer includes `tabs`, broad host scopes, or `<all_urls>` — the host is only `*.feishu.cn`, which is review-friendly.
- If your public edition **does not do web clipping**, consider removing `contextMenus`/`commands`/`scripting` (turn off `CLIP_ENABLED` at build time) to further reduce permissions and lower review risk.

### 4.5 Compliance of Bring-Your-Own App
"Letting users fill in their own App ID/Secret" is fully compliant (many developer tools do this); be sure to state in the description that **users need to provide their own self-built Feishu app**, to avoid bad reviews from people who install it but can't use it.

---

## 5. After Submission / Update Flow
1. The first submission usually takes a few days to review; if rejected, you'll get a reason — apply the corresponding explanation/fix per §4 and resubmit.
2. Update: change code → `npm run build` (remember to bump `manifest.version` by +1) → compress to zip → upload the new version in the console → wait for review.
3. The Store edition **does not** need a fixed ID with a `key`/private key (the store assigns an ID); if you want a stable ID, you can keep the `key`.

> Companion docs: privacy policy [`PRIVACY.md`](../PRIVACY.md), security model [`SECURITY_AUDIT.md`](../SECURITY_AUDIT.en.md), user onboarding [`QUICKSTART.md`](QUICKSTART.en.md).
