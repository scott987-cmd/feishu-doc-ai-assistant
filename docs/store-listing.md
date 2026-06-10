# Chrome 商店商品信息（可直接复制）/ Store listing copy

> 上架流程与审核规避见 [`STORE_PUBLISHING.md`](STORE_PUBLISHING.md)。下面是可直接粘贴到开发者后台的文案。
> 命名刻意**避免暗示官方**（"飞书"是字节跳动商标），并带"非官方"声明，降低被拒概率。
>
> ⚠️ **名称 与 简短说明 不在控制台填**——它们取自包的 `manifest.name`/`description`，已由
> `VITE_WEBSTORE=1` 构建**自动写入**（值与下方一致；要改用 `VITE_STORE_NAME/_DESC`）。
> 控制台里要填的是：**详细说明、单一用途、隐私政策 URL、权限理由、截图、审核备注**。

---

## 中文

**名称（建议，避免商标误导）**
```
AI 助手 for 飞书 · 多维表格/文档/电子表格（第三方）
```

**简短描述（≤132 字）**
```
第三方开源工具：在飞书多维表格/文档/电子表格里用一句话让 AI 建表、填数、做图表看板、写分析报告、做 PPT、总结体检文档。以你本人身份操作，无后端。
```

**详细描述**
```
用自然语言操作飞书，把繁琐操作交给 AI。

【能做什么】
• 多维表格/电子表格：建表改表、填数、写公式、跨表查找、去重、按条件批量改、审计
• 文档：Markdown 转文档、内容总结、文档体检（找逻辑断点/TODO/过期数据）
• 把数据做成页面：AI 看板/小程序、AI 建站、AI 幻灯片(PPT)，可导出 PDF/飞书文档
• 智能填充：参考同行推断空缺值，预览后一键写回
• 数据分析报告：读真实数据写带数字的分析，生成飞书文档

【安全】
• 始终以你本人飞书身份操作，绝不越权；不删除整表/文档
• 所有凭据本机加密存储，无自有后端，不收集你的数据
• AI 生成的页面代码在隔离沙箱中运行，无网络出站

【使用前提】
本扩展需要你自备一个飞书自建应用（填入你自己的 App ID / App Secret，仅存本机加密），
并自配大模型 API Key（OpenAI 兼容，如 DeepSeek）。首次配置见扩展内指引。

本扩展为第三方开源工具，与飞书 / 字节跳动无任何官方关联。
开源地址：https://github.com/scott987-cmd/feishu-doc-ai-assistant
```

**单一用途（Single purpose）**
```
用自然语言操作飞书多维表格 / 文档 / 电子表格的 AI 助手。
```

**分类**：Productivity（效率） · **语言**：中文（简体）

---

## English

**Name**
```
AI Assistant for Feishu/Lark · Base/Docs/Sheets (3rd-party)
```

**Short description (≤132 chars)**
```
Third-party tool: operate Feishu Base/Docs/Sheets in natural language — build tables, fill data, charts, dashboards, reports, slides. Acts as you. No backend.
```

**Detailed description**
```
Operate Feishu in natural language and hand the tedious work to AI.

WHAT IT DOES
• Base/Sheets: create/edit tables, fill data, formulas, cross-table lookup, dedup, conditional bulk edits, audit
• Docs: Markdown→doc, summarize, doc health-check (logic gaps / TODOs / stale data)
• Turn data into pages: AI dashboards/mini-apps, AI websites, AI slides (PPT); export PDF / Feishu doc
• Smart fill: infer missing values from peers, preview, one-click write-back
• Data reports: read real data, write a numbers-backed analysis as a Feishu doc

SECURITY
• Always acts as YOUR Feishu identity, never beyond your permissions; never deletes whole tables/docs
• All credentials stored encrypted on-device; no backend; we do not collect your data
• AI-generated page code runs in an isolated sandbox with no network egress

REQUIREMENTS
You provide your own Feishu custom app (enter your own App ID / App Secret, stored encrypted
on-device only) and your own LLM API key (OpenAI-compatible, e.g. DeepSeek). See the in-app guide.

This is an independent, open-source, third-party tool, not affiliated with Feishu / ByteDance.
Source: https://github.com/scott987-cmd/feishu-doc-ai-assistant
```

**Single purpose**
```
An AI assistant to operate Feishu Base / Docs / Sheets via natural language.
```

**Category**: Productivity · **Language**: English (+ Simplified Chinese)

---

## 审核备注（提交时贴到 "Notes to reviewer"）/ Notes to reviewer

```
This store build executes NO remote code. The AI only returns a declarative JSON spec
(data describing charts/dashboards/tables/slides); a bundled interpreter renders it via
ECharts and built-in UI inside an isolated sandboxed iframe (opaque origin, CSP
connect-src 'none', no 'unsafe-eval'). The bundle contains no eval/new Function (verifiable:
`npx vite build --mode store && node scripts/check-no-eval.mjs`). The extension's logic is
fully bundled; nothing is fetched and executed as script at runtime. The broad
connect-src 'https:' on extension pages exists only so users can connect to THEIR OWN chosen
OpenAI-compatible LLM endpoint (configured by the user), not any developer server. No
credentials are bundled; each user enters their own Feishu app credentials and LLM key,
stored encrypted on-device. Security details:
https://github.com/scott987-cmd/feishu-doc-ai-assistant/blob/main/SECURITY_AUDIT.md
```

---

## 权限理由（开发者后台逐框照填）/ Permission justifications

> 后台「需请求权限的理由」每个框对应一段，直接粘贴。突出"单一用途 + 最小必要"。

- **sidePanel**：提供本扩展的主界面。用户在飞书页面打开侧边栏，用自然语言下达指令（建表、填数、写公式、生成看板/PPT、总结/体检文档等）。这是扩展唯一的交互入口，为实现核心功能所必需。
- **storage**：在本机 chrome.storage.local 中加密保存用户的设置与凭据：用户自己的飞书 App ID / App Secret、飞书 OAuth 令牌、大模型 API Key 及界面偏好。全部仅存本地、不上传任何服务器。无此权限用户每次都需重新配置与授权。
- **activeTab**：读取用户当前正在查看的飞书标签页上下文（如当前多维表格/文档的标识），以便把用户的自然语言指令作用到“当前这篇文档/这张表”，无需用户手动粘贴 ID。仅在用户主动发起操作时使用。
- **identity**：通过 chrome.identity 发起飞书 OAuth 登录（launchWebAuthFlow），获取用户本人的 user_access_token。扩展始终以用户本人身份调用飞书开放平台，绝不使用应用/租户身份越权。无此权限无法完成飞书登录授权。
- **scripting**：在飞书页面注入内容脚本与侧边栏桥接，读取当前页面上下文，并在页面上渲染由用户触发的结果（如数据看板悬浮窗）。仅作用于飞书域名页面，用于执行用户下达的指令。
- **contextMenus**：提供右键菜单项“剪藏到飞书”，让用户把当前网页内容整理后写入自己的飞书多维表格/文档。属可选的便捷入口。
- **commands**：注册键盘快捷键（Alt+Shift+C）触发“剪藏到飞书”，与右键菜单等效，纯属操作便捷用途。
- **主机权限 https://*.feishu.cn/***：本扩展只在飞书域名（*.feishu.cn）下工作：需要在飞书页面注入侧边栏、读取当前多维表格/文档/电子表格的上下文，并以用户本人身份调用飞书开放平台 API 完成用户指令。仅限飞书域名，不请求任何其它网站。
