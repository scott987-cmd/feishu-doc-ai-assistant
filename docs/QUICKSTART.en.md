> 🌐 **English** | [中文](QUICKSTART.md)

# Personal Quick Deployment (5 Steps to Get Started)

> Aimed at **personal use** (install it yourself, use it yourself, not distributed to others / not published to a store). For enterprise / private deployment, see [`DEPLOYMENT.md`](DEPLOYMENT.en.md) / [`PRIVATE_DEPLOYMENT.md`](PRIVATE_DEPLOYMENT.en.md).
> **Publishing to the Chrome Web Store** (no credentials in the build, users bring their own Feishu app): see [`STORE_PUBLISHING.md`](STORE_PUBLISHING.en.md).
> If you get stuck, check [`FAQ.md`](FAQ.en.md).

The whole flow is just: **configure the Feishu app → fill in build config → one-click pack → load → authorize and use**.

---

## 1. Create and Configure the Feishu App

1. Open **[open.feishu.cn](https://open.feishu.cn) → Developer Console → Create a custom enterprise app**, and note down the **App ID** and **App Secret**.
2. **Permission Management**: enable the scopes below, and **check "User identity" for each one** (this extension always operates as you personally, not as the app identity):

   | scope | Purpose | Required? |
   |---|---|---|
   | `offline_access` | Exchange for refresh_token (otherwise the token expires in ~2h and throws 99991677) | **Required** |
   | `bitable:app` | Base: create/read/write tables, fields, records | Only if used |
   | `docx:document` | Doc: read/write content blocks | Only if used |
   | `sheets:spreadsheet` | Sheet: read/write ranges/rows/columns | Only if used |
   | `drive:drive` | Cloud space: create new Base/Doc/Sheet | Only if used |
   | `wiki:wiki` | Recognize/operate inside Wiki | Only if used |
   | `contact:user.base:readonly` | Get your own open_id | Recommended |

   **Do NOT enable** (also hard-blocked in code): `im`, `contact:contact`, `transfer_owner`, `permissions`, `admin`.

3. **Security Settings → Redirect URL**: add `https://jhdbgegkmhcopcilclkpioilclemkeog.chromiumapp.org/` (including the trailing slash).
   > This ID is fixed by the signing key built into the repo. If you forked and switched to your own key, change it to the callback corresponding to your own extension ID.
4. **Availability**: add yourself (or everyone).
5. **Publish**: create a version → submit for release (during testing, you can also just add yourself as a "test member" for instant effect).

> After changing permissions, if the app is already "published", you must **create another version and publish it** for the changes to take effect.

---

## 2. Configure the Build (`.env.local`)

```bash
git clone <repo> && cd feishu-doc-ai-assistant
npm install
cp .env.example .env.local        # 已被 .gitignore，安全
```

Fill in `.env.local`. For personal use, pick one of the two options below:

**A. Direct connection · plaintext (simplest, purely for personal use)**
```bash
VITE_FEISHU_APP_ID=cli_你的AppID
VITE_FEISHU_APP_SECRET=你的AppSecret
```

**B. Direct connection · password-encrypted (recommended: the secret does not enter the bundle in plaintext)**
```bash
node scripts/encrypt-secret.mjs      # 按提示输入 App Secret + 自设解锁密码 → 输出密文
# 然后填：
VITE_FEISHU_APP_ID=cli_你的AppID
VITE_FEISHU_APP_SECRET_ENC=上一步输出的密文
VITE_FEISHU_APP_SECRET=              # 留空！
```
When using B, after installation you just need to **enter the unlock password once** under "Settings → Feishu Authentication".

> - Scopes like `offline_access` are **requested automatically** by the code; no need to configure them again here.
> - **The LLM key is not in the build** — fill it in at runtime under the extension's "Settings" (OpenAI-compatible, DeepSeek by default).
> - Don't want to bundle any credentials? Leaving all three secret variables empty is fine too; at runtime, paste your own `user_access_token` in the settings.

---

## 3. One-Click Pack

```bash
npm run pack
```
This automatically: builds → outputs `dist/` → compresses into `feishu-doc-ai-assistant.zip` (→ and produces a `.crx` if a signing private key is present).
For personal use you **only need `dist/`**; the zip is for backup / sharing with others.

> If you only want to build without packing: `npm run build` (produces `dist/`).

---

## 4. Load into Chrome

1. `chrome://extensions` → turn on **Developer mode** in the top right.
2. **"Load unpacked"** → select the **`dist/`** directory.
3. Pin it to the toolbar (optional). The extension ID will be `jhdbgegk…` (matching the redirect URL from step 1).

---

## 5. First Use

1. Open any Feishu **Base / Sheet / Doc** page → click the extension icon to bring up the **sidebar**.
2. In **Settings**:
   - (If you used the encrypted version B) **enter the unlock password**.
   - Click **Authorize with Feishu account** (goes through OAuth to obtain your personal token).
   - Fill in the **LLM API Key** (e.g. DeepSeek's `sk-…`).
3. Go back to the dialog box and get started in one sentence: "Create a project management table with name/status/owner/due date, and add 5 sample rows."

---

## Common Sticking Points

| Symptom | Solution |
|---|---|
| Authorization throws **20027 / offline_access needs to be enabled** | In step 1, enable `offline_access` and (if already published) re-release → re-authorize |
| Error reading a doc / "can't recognize the document" | Enable `docx:document` (user identity) + re-authorize |
| 403 no permission | The resource isn't yours / isn't shared with you; operate with an account that has permission |
| Encrypted version doesn't work | In settings, **enter the unlock password** to unlock first, then authorize |
| Need to re-verify after changing code | `npm run build` → `chrome://extensions`, click **🔄 Refresh** on the extension |

For more, see [`FAQ.md`](FAQ.en.md).
