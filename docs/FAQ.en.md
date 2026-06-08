> 🌐 **English** | [中文](FAQ.md)

# FAQ / Troubleshooting Handbook

> For users and operators. For development/iteration questions, see [`DEVELOPMENT.md`](DEVELOPMENT.en.md).

## Authentication / Login

**Q: After about 2 hours I get `Feishu API error (code=99991677): token expired`?**
A Feishu `user_access_token` only lives ~2 hours on its own; it relies on the `refresh_token` to auto-renew up to ~30 days. If it isn't renewing, the most likely cause is a **missing `offline_access` scope during authorization** (without it, Feishu won't issue a refresh_token).
- The code has been changed to **always request `offline_access`**; but you need to **re-run "Feishu authorization" once** (the old token had no refresh_token).
- In the admin console "Permission Management", confirm `offline_access` is enabled. After re-authorizing, it will auto-renew and no longer drop offline every 2h.

**Q: I see "Please authorize with your Feishu account first" / 401 / login invalid?**
A "Feishu login has expired" banner appears at the top; click it to go back to settings and **re-authorize**. The assistant only acts **as you yourself**.

**Q: `403 / no edit permission`?**
This doc/table wasn't created by you, or it hasn't been shared with you. Use an account that has permission, or in the doc's top-right "Share" add yourself/the app as an editable collaborator. The assistant **never escalates privileges** (it does not fall back to the app identity).

**Q: The encrypted build won't open (unlock password)?**
The secret in the personal/encrypted build is ciphertext and must be unlocked once via **Settings → Feishu Auth → enter unlock password**. The password is set at packaging time by `scripts/encrypt-secret.mjs` (**copy the whole string, including any leading/trailing symbols**); if you maintain multiple encrypted builds, note that each build has its own unlock password.

## Generation / Export

**Q: Clicking "Export PDF" on PPT / dashboard / website does nothing?**
The old version had `window.print()` silently blocked because the sandbox lacked `allow-modals`; this is fixed. After **reloading the extension**, use the **🖨** in the floating window's title bar (PPT exports one slide per page).

**Q: The prompt says a dozen seconds, but it actually takes tens of seconds?**
PPT/site-building/reports are multi-step LLM generations, so **tens of seconds and up** is normal (the prompt now says "takes about tens of seconds"). Wait patiently, or click "Cancel" in the panel.

**Q: I switched to another browser tab and came back—did my generated content get lost?**
No. AI mini-program/site-building/slides results are cached per page and restore automatically when you return; saved ones live in "My Websites / My Presentations / dashboard pills".

**Q: How do I adjust the color scheme?**
The floating window's title bar **🎨**: 7 brand colors + a custom color picker, recoloring PPT/website/dashboard/charts in real time; **↺** restores the default.

## Data / Upgrades

**Q: Will an update lose my saved dashboards/PPTs?**
**No.** They are all stored in `chrome.storage.local` (PPT=`slides_decks_v1`, dashboard/website=`dataviz_v1`), and a Chrome extension update does not clear it. They are only lost if you **uninstall and reinstall** or the **extension ID changes** (the private key `extension-key.pem` was lost/replaced).

**Q: The floating window/panel can't recognize a table inside a Wiki?**
Supported—it automatically resolves the Wiki to the real underlying table/doc behind it. If it still can't recognize it, just open the table/doc itself directly.

**Q: Does it send data to the LLM?**
Only when executing a task you explicitly initiate does it send **necessary and capped** data to **the LLM you configured yourself**; generated code running in the sandbox has `connect-src 'none'`, so **even with the data it can't send anything out**.

## Private Deployment

**Q: Some operation in private deployment returns 404, but the feature should be supported?**
Private Feishu versions often lag behind SaaS. The request layer **automatically falls back** `/<service>/vN/` → `v(N-1)` (see [`PRIVATE_DEPLOYMENT.md`](PRIVATE_DEPLOYMENT.en.md) §6). If it still 404s, that endpoint may not be available in your private version.

**Q: LLM requests are rejected?**
The private build locks `VITE_OPENAI_ALLOWED_HOSTS`; the Base URL must fall within the allowlist.

**Q: Full-screen "Checking network access permission"?**
`VITE_ALLOWED_CIDRS` is set but the browser (WebRTC mDNS) can't obtain the internal IP. Switch to gateway-level restriction, or adjust this config.

## Installation

**Q: Dragging in the `.crx` won't install?**
Regular Chrome blocks `.crx` installs from outside the store by default. For personal use, the most reliable path is **unzip the zip → Developer Mode → Load unpacked**; for enterprises, install via MDM policy (see [`enterprise/DEPLOY.md`](enterprise/DEPLOY.en.md)).

**Q: Where do I enter the LLM Key?**
Each user enters it themselves in **Settings** (OpenAI-compatible, DeepSeek by default); it's stored only on your machine, saved encrypted.

## Enterprise Edition (centrally provisioned LLM)

**Q: The company-issued build works even though I never entered an API Key?**
The Enterprise Edition can have the LLM config centrally provisioned by the company: after you **authorize with your company Feishu account**, it's fetched automatically with no Key needed. In Settings, "LLM config source" can switch between "Enterprise unified / Manual" (admins may lock it to enterprise-unified only).

**Q: I see "Your account does not belong to this enterprise, cannot fetch LLM config"?**
Your Feishu account is not within the company app's availability scope/tenant. Re-authorize with your **company Feishu account**; if it still fails, ask the admin to add you to the availability scope.

**Q: After the company changed the LLM key, I get errors?**
Settings → "LLM config source" → click **Re-fetch** (clears the locally cached old config and pulls again).

**Q: How does the admin configure this?**
On the proxy set `LLM_BASE_URL/LLM_API_KEY/LLM_MODEL` + the **required `FEISHU_TENANT_KEY`**, and build the client with `VITE_LLM_FROM_PROXY=1`. See [`DEPLOYMENT.md` §3.4](DEPLOYMENT.en.md) and [`oauth-proxy/README.md` §5](oauth-proxy/README.en.md).
