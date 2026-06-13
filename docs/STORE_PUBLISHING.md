> 🌐 [English](STORE_PUBLISHING.en.md) | **中文**

# 上架 Chrome 应用商店（公开版）

公开发行的核心原则：**扩展包里不内置任何凭据**。每个用户填自己的飞书 App ID + Secret（本机加密存）。
本文覆盖：① 公开版怎么构建 → ② 用户首次怎么配 → ③ 上架清单（逐条）→ ④ 审核风险与规避 → ⑤ 更新流程。

---

## 1. 构建公开版（零凭据 + 无 key 包）

商店包有两条硬性要求：**① 不内置任何凭据** ② **manifest 里不能有 `key` 字段**（ID 由商店分配，带 `key` 会报"清单文件中不得包含 key 字段"上传失败）。

用一个独立的 `.env.store.local`（已 gitignore，不动你的 `.env.local`）：
```bash
cat > .env.store.local <<'E'
VITE_FEISHU_APP_ID=
VITE_FEISHU_APP_SECRET=
VITE_FEISHU_APP_SECRET_ENC=
VITE_OAUTH_PROXY_URL=
VITE_WEBSTORE=1
E
npx vite build --mode store          # 零凭据 + 自动剥离 manifest.key
cd dist && zip -qr ../feishu-doc-ai-assistant-store.zip . && cd ..
```
> `VITE_WEBSTORE=1` 让构建删除 `manifest.key`；`--mode store` 使 Vite 读 `.env.store.local`（其空值覆盖 `.env.local` 的凭据）。

自检——**包里不能有 secret，manifest 不能有 key**：
```bash
grep -riE "cli_[a-z0-9]{16}" dist/ ; echo "↑ 应为空（无 App ID）"
grep -o '"key"' dist/manifest.json ; echo "↑ 应为空（无 key 字段）"
```
上传 `feishu-doc-ai-assistant-store.zip` 到 Chrome 开发者后台。

> 商店版会自动进入「自带应用」模式：设置里出现"自建飞书应用"录入区，用户填自己的 App ID/Secret。
> 去掉 `key` 后扩展 ID 由商店分配 → OAuth 重定向 URL 随之变化，但设置页会**运行时显示当前真实回调地址**，用户照着登记即可。

**商店标题/摘要 = 包里的 `manifest.name`/`description`（控制台改不了）**，且默认名"飞书文档AI助手"读起来像官方（商标风险）。所以 `VITE_WEBSTORE=1` 会**自动**把名称/摘要换成合规的第三方版：
- 名称：`AI 助手 for 飞书 · 表格/文档/电子表格（第三方）`
- 摘要：`第三方开源工具……与飞书无官方关联。`
- 想自定义就在 `.env.store.local` 里设 `VITE_STORE_NAME=` / `VITE_STORE_DESC=`（摘要 ≤132 字）。
- 图标已是原创 AI 星芒（非字母、非飞书蓝），不含任何飞书/品牌元素。

---

## 2. 用户首次配置（写进你的商品描述/帮助）

装好后，用户需要一次性：
1. 去 [open.feishu.cn](https://open.feishu.cn) 创建一个**企业自建应用**，拿 **App ID / App Secret**。
2. 在应用「权限管理」开通（都勾**用户身份**）：`offline_access`（必须）+ 按需 `bitable:app` `docx:document` `sheets:spreadsheet` `drive:drive` `wiki:wiki` `contact:user.base:readonly`。
3. 「安全设置 → 重定向 URL」填扩展里显示的回调地址（设置页会自动展示，形如 `https://<扩展ID>.chromiumapp.org/`）。
4. 把自己加进「可用范围」并**发布**。
5. 回扩展 → 设置 → **自建飞书应用** 填 App ID + Secret → 保存 → **用飞书账号授权** → 填大模型 Key → 开用。

> 详见 [`QUICKSTART.md`](QUICKSTART.md)。重定向 URL 必须**完全一致**（含末尾斜杠）。

---

## 3. Chrome 应用商店上架清单

### 3.1 账号与基础
- [ ] 注册 **Chrome 开发者账号**（一次性 $5）：https://chrome.google.com/webstore/devconsole
- [ ] `manifest.json` 的 `name` / `description` / `version` / 图标(16/32/48/128) 齐全 ✅（本项目已具备）
- [ ] 上传 zip（`dist/` 压缩）

### 3.2 隐私与数据（最容易卡的部分）
- [ ] **隐私政策 URL**（必填）：用本仓库的 [`PRIVACY.md`](../PRIVACY.md)，托管成可访问 URL，例如
      `https://github.com/scott987-cmd/feishu-doc-ai-assistant/blob/main/PRIVACY.md`，填进开发者后台「隐私权」页。
- [ ] **单一用途说明（Single purpose）**：填"用自然语言操作飞书多维表格/文档/电子表格的 AI 助手"。
- [ ] **数据用途声明**（开发者后台逐项勾选）：
      - 处理的数据：网站内容(飞书页面内容)、用户活动(你的指令)、身份验证信息(OAuth token)。
      - 勾选：**不出售/不转让给第三方**；**不用于无关用途**；**不用于判定信用**。
      - 关键如实声明：数据只发往**用户自己配置的**飞书与大模型，作者不收集。
- [ ] **逐条权限理由**（"为何需要"，填这几条）：

| 权限 | 理由（可直接用） |
|---|---|
| `identity` | 走飞书 OAuth，获取用户本人的 user_access_token（仅用户身份） |
| `storage` | 本机加密保存用户的凭据与设置 |
| `sidePanel` | 提供侧边栏主界面 |
| `scripting` + `activeTab` + host `*.feishu.cn` | 在飞书页面注入侧边栏、读取当前页面上下文以执行用户指令 |
| `contextMenus` | 右键"剪藏到飞书"入口 |
| `commands` | 快捷键触发剪藏 |
| host_permissions `https://*.feishu.cn/*` | 仅限飞书域名，扩展只在飞书页面工作 |

### 3.3 商品信息（Listing）
- [ ] **标题**：见 §4.3 商标提示（别让人误以为是飞书官方）。
- [ ] **简短描述**（≤132 字）。
- [ ] **详细描述**：可直接搬 README 的功能要点。
- [ ] **分类**：Productivity / 办公。
- [ ] **语言**：中文（简体），可加英文。
- [ ] **截图**：1~5 张，**1280×800**、**24 位 PNG 无 alpha**。现成的：`npm run screenshots:store` → `docs/store-screenshots/store{1..5}.png`（已合成好标题+UI，符合规格，直接上传）。
- [ ] **小型宣传图块**（可选）：440×280 · 24位PNG无alpha。现成的：`npm run promo` → `docs/store-screenshots/promo-440x280.png`。
- [ ] **顶部宣传图块/跑马灯**（可选）：1400×560 · 24位PNG无alpha。现成的：`npm run promo:marquee` → `docs/store-screenshots/marquee-1400x560.png`。
- [ ] **宣传视频**（可选但强烈建议）：填你的 YouTube 链接 `https://youtu.be/JhPNeOK1n8g`。
- [ ] **商店图标** 128×128 ✅。

---

## 4. 审核风险与规避（重点——这几条最容易被拒）

### 4.1 ⚠️ 商标 / "官方"误导（高频拒因）
"飞书"是字节跳动商标。商店会拒绝**让人误以为是官方**的扩展。
- **改名**：别用纯"飞书文档AI助手"暗示官方；用明确的第三方名，如 **"AI 助手 for 飞书（非官方）"** 或 **"飞书多维表格 AI 助手 · 第三方"**。
- 描述里加一句：**"本扩展为第三方开源工具，与飞书 / 字节跳动无官方关联。"**

### 4.2 ✅ 远程代码 —— 商店版已做到"无远程代码"（Plan B）
"您是否使用远程代码？"这一题，**商店版（`VITE_WEBSTORE=1`）可如实选「否」**。

构建为商店版时，自动启用**数据驱动渲染（无 eval）**：
- 大模型只产出**声明式 JSON 规格（VizSpec：数据，不是代码）**；
- 沙箱内**打包好的解释器**用它调 ECharts / 内置 UI 渲染图表 / 看板 / 表 / 数据网站 / 幻灯片；
- 因此沙箱 CSP **去掉了 `unsafe-eval`**，且包内**没有任何 `new Function` / `eval`**——运行时不执行任何远端取得的代码。

**自证（提交前跑一遍，可截图给审核）**：
```bash
npx vite build --mode store     # 含 VITE_WEBSTORE=1
node scripts/check-no-eval.mjs  # → ✅ dist/ 中无 new Function(
```
- **覆盖**：图表 / 多图看板 / 明细表 / 数据网站 / 幻灯片(PPT) 全部数据驱动。
- **缺口（如实告知）**：商店版的"AI 建站"是**数据看板式网站**，不含自由式网页 / 计算器 / 自定义脚本视图——那些需要执行生成代码，只在**自分发版**（保留 `unsafe-eval`）提供。建站面板在商店版已有相应提示。
> 注：自分发 / 企业内网版（不上架）仍用"生成即运行"的全功能，不受商店远程代码政策约束。

### 4.3 ⚠️ 宽 `connect-src https:`
为支持用户**自填任意大模型地址**，扩展页 CSP 的 `connect-src` 含 `https:` 通配。说明：这是为了让用户连**自己选择的** OpenAI 兼容服务，不是为了连作者服务器；数据只发往用户配置的端点。

### 4.4 权限最小化
- 已不含 `tabs`、广域 host、`<all_urls>`——host 仅 `*.feishu.cn`，审核友好。
- 若你的公开版**不做网页剪藏**，可考虑去掉 `contextMenus`/`commands`/`scripting`（构建时关 `CLIP_ENABLED`），进一步减权限、降审核风险。

### 4.5 自带 App 的合规性
"让用户填自己的 App ID/Secret"完全合规（很多开发者工具如此）；务必在描述里说明**需要用户自备飞书自建应用**，避免装了不会用导致差评。

---

## 5. 提交后 / 更新流程
1. 首次提交后审核通常几天；被拒会给原因，按 §4 对应解释/整改后复审。
2. 更新：改代码 → `npm run build`（`manifest.version` 记得 +1）→ 压 zip → 后台上传新版本 → 等审核。
3. 商店版**不要**带 `key`/私钥的固定 ID 也行（商店会分配 ID）；若想 ID 稳定可保留 `key`。

> 配套：隐私政策 [`PRIVACY.md`](../PRIVACY.md)、安全模型 [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md)、用户上手 [`QUICKSTART.md`](QUICKSTART.md)。
