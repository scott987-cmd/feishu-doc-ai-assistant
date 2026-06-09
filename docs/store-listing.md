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
This extension does NOT load or execute remotely-hosted code. The visualization/page
code is text returned by an LLM and rendered locally inside an isolated sandboxed iframe
(opaque origin) whose CSP is connect-src 'none' — it has no network access and cannot
exfiltrate data. The extension's own logic is fully bundled; nothing is fetched and run as
remote script at runtime. The broad connect-src 'https:' on extension pages exists only so
users can connect to THEIR OWN chosen OpenAI-compatible LLM endpoint (configured by the
user), not any developer server. No credentials are bundled; each user enters their own
Feishu app credentials and LLM key, stored encrypted on-device. Security details:
https://github.com/scott987-cmd/feishu-doc-ai-assistant/blob/main/SECURITY_AUDIT.md
```
