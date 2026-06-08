> 🌐 **English** | [中文](DEPLOY.md)

# Internal Enterprise Distribution (no Google Web Store listing, no developer mode)

Goal: have employees' Chrome **automatically install** this extension, with no manual steps and without going through the Chrome Web Store.
The only reliable way = **Chrome enterprise policy "force install" + self-hosted .crx**. The extension ID is pinned via `key` to
`jhdbgegkmhcopcilclkpioilclemkeog`, so the IDs of the .crx, the update manifest, and the policy always match.

> Regular users **cannot** install a .crx by dragging it in manually (modern Chrome blocks non-store extensions outright)—this is exactly why you must go through policy.

---

## 1. Build the .crx (signed with the project's private key, ID pinned)

```bash
# SaaS package (current dist):
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --pack-extension="$(pwd)/dist" --pack-extension-key="$(pwd)/extension-key.pem" --no-message-box
mv -f dist.crx feishu-ai-saas.crx
```
- When switching packages (e.g. a private-deployment package): first run `npm run build` with the corresponding env to generate dist, then repack the .crx.
- **Every update must bump manifest.json's `version` by one**, and correspondingly change the version in `update_manifest.xml`, so the browser will auto-pull the new version.
- `extension-key.pem` is the signing private key—**keep it secret, never commit it** (already gitignored); losing it changes the ID and breaks seamless updates.

## 2. Host on internal HTTPS

Place these two files at an **HTTPS address reachable by the managed browsers** (an internal web/file server or object storage all work):
- `feishu-ai-saas.crx`
- `update_manifest.xml` (change its `codebase` to the real URL of the .crx)

> HTTPS is required. http or an unreachable URL will cause the policy install to fail.

## 3. Push the "force install" policy (pick one, based on how you manage devices)

### A. Google Workspace Admin Console (simplest when you have Google-managed accounts)
admin.google.com → Devices → Chrome → Apps & extensions → "Users & browsers"
→ bottom-right ➕ → "Add Chrome app or extension by ID"
→ enter the extension ID `jhdbgegkmhcopcilclkpioilclemkeog`, set source to "Custom" and fill in the URL of `update_manifest.xml`
→ set the install policy to "**Force install**" → Save.
Just scope the availability by organizational unit (OU).

### B. Windows Group Policy (GPO, domain environment)
Administrative Templates → Google → Google Chrome → Extensions → **Configure the list of force-installed apps and extensions**
(ExtensionInstallForcelist), add a line:
```
jhdbgegkmhcopcilclkpioilclemkeog;https://YOUR-INTERNAL-HOST/update_manifest.xml
```
(You must import the Chrome ADMX templates first.)

### C. macOS (MDM) — recommended; this repo ships a ready-made profile
Ready-made file: **`docs/enterprise/feishu-ai-chrome-forceinstall.mobileconfig`**
(already contains the pinned extension ID + correct payload, and has passed plist validation).

Usage:
1. Change `YOUR-INTERNAL-HOST` in the file to the internal HTTPS address where you host `update_manifest.xml`.
2. Push it to devices via your MDM (System scope). Where to find it in each console:
   - **Jamf Pro**: Configuration Profiles → New → **Application & Custom Settings → Upload**
     upload this .mobileconfig (or set the Preference Domain to `com.google.Chrome` and paste the plist content).
   - **Intune**: Devices → Configuration → create a new "**Preference file**" configuration,
     custom configuration profile name `com.google.Chrome`, upload this .mobileconfig.
   - **Kandji**: Library → Add → **Custom Profile** → upload this .mobileconfig.
   - **Mosyle / SimpleMDM, etc.**: Custom Profile / Custom Configuration → upload this .mobileconfig.

Under the hood this just writes a **managed** key to the `com.google.Chrome` preference domain:
```
ExtensionInstallForcelist = [
  "jhdbgegkmhcopcilclkpioilclemkeog;https://YOUR-INTERNAL-HOST/update_manifest.xml"
]
```
> Note: it must be a **managed** preference pushed by MDM (a configuration profile); a plain `defaults write` is not honored by Chrome.

**Verify** (on the employee's machine): `chrome://policy` shows the ExtensionInstallForcelist entry +
`chrome://extensions` automatically shows the extension (which cannot be removed) means success. It usually takes effect within a few minutes, or after restarting Chrome.

Once the policy takes effect, the managed Chrome will **auto-install, auto-update, and the user cannot uninstall it**—zero operations throughout.
Verify: the employee's machine sees the policy at `chrome://policy` + the extension appears at `chrome://extensions` means success.

---

## 4. Don't forget the one-time setup (independent of distribution)

### 4.1 Feishu app permissions (Open Platform → App → Permission management)
This extension **is not a bot**—it operates **as the user themselves (user_access_token) via OAuth**, so you must enable the following scopes,
**all checked under "User identity"** (the console has two columns, "App identity / User identity"; at runtime only user identity is used):

| scope | purpose |
|---|---|
| `offline_access` | **Required**: to obtain a refresh_token; otherwise the user_access_token expires in about **2 hours** and cannot be renewed (returns code=99991677) |
| `bitable:app` | Base: create/read/write tables, fields, records, views |
| `docx:document` | Docs: create documents, read/write content blocks |
| `sheets:spreadsheet` | Sheets: read/write ranges, rows and columns |
| `drive:drive` | Drive: create files/folders (Base/Docs/Sheets all land in Drive) |
| `wiki:wiki` | Wiki: recognize/operate on wiki documents (only needed if used) |
| `contact:user.base:readonly` | Read your own basic info (to get open_id) |

- This is the `VITE_FEISHU_OAUTH_SCOPE` used at build time; **what you enable in the console must match it**, and missing one means that category of operation returns 403.
- **Not needed** (and hard-blocked by the code's `API_BLOCKED`): bot/messaging `im`, contacts `contact:contact`,
  transfer ownership `transfer_owner`, permission management `permissions`, `admin`.

### 4.2 Other one-time setup
- **Redirect URL**: Security settings → Redirect URLs, add `https://jhdbgegkmhcopcilclkpioilclemkeog.chromiumapp.org/` (with the trailing slash).
- **Publish the app**: Create version → Submit for release → set availability to everyone/departments (otherwise only test members can authorize).
- **Unlock password** (encrypted secret scheme): send the shared password in `unlock-password.txt` to users along with usage instructions,
  and have them unlock once in "Settings" on first use.
- **LLM Key**: each user fills in their own under "Settings" (everyone brings their own).
- **Private-deployment package**: rebuild with each instance's own app_id/secret and repack the .crx, host it internally, and point the policy's codebase at it.

## 5. Update flow (releasing a new version)
1. Change code → `npm run build` → bump manifest `version` by 1 (the build will include it).
2. Repack the .crx (same private key) → overwrite the .crx on the internal host.
3. Change `update_manifest.xml`'s `version` to the new version number → overwrite.
4. Managed browsers auto-update within a few hours (or after a restart); if it's urgent, have users click "Update" at `chrome://extensions`.
