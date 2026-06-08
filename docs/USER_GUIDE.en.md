> 🌐 **English** | [中文](USER_GUIDE.md)

# Feishu Doc AI Assistant · User Manual

> A Chrome side-panel extension: inside Feishu's **Base / Sheet / Doc** pages, use a single sentence to let AI
> build tables, fill data, write formulas, make charts, generate websites, write analysis reports, make slides, summarize/audit documents… **No backend — everything runs as you, in your own identity.**
>
> The screenshots in this manual are taken from the built-in UI preview (`npm run dev:ui`) and match the actual side panel.

---

## Table of Contents

1. [Installation and First-Time Setup](#1-installation-and-first-time-setup)
2. [Overall Interface: Chat / Scenarios](#2-overall-interface-chat--scenarios)
3. [Chat: Operate Feishu with Natural Language](#3-chat-operate-feishu-with-natural-language)
4. [Scenarios: A Capability Hub Smart-Grouped by the Current Page](#4-scenarios-a-capability-hub-smart-grouped-by-the-current-page)
5. [Turn Data into Pages: AI Mini-App / AI Site Builder](#5-turn-data-into-pages-ai-mini-app--ai-site-builder)
6. [Data Processing and Analysis: Smart Fill / Data Analysis Report](#6-data-processing-and-analysis-smart-fill--data-analysis-report)
7. [Document Processing: Document Audit / Document Summary](#7-document-processing-document-audit--document-summary)
8. [🎞️ AI Slides (Doc/Table to PPT) — Highlight](#8--ai-slides-doctable-to-ppt--highlight)
9. [Build / Set Up a Base: Scenario Template Gallery](#9-build--set-up-a-base-scenario-template-gallery)
10. [Web Capture: Clip / Scrape / Recognize / Import](#10-web-capture-clip--scrape--recognize--import)
11. [Frequently Asked Questions (FAQ)](#11-frequently-asked-questions-faq)

---

## 1. Installation and First-Time Setup

1. Load the extension (dev build: `chrome://extensions` → enable "Developer mode" → "Load unpacked" → select the `dist/` directory; or install the `.crx`).
2. Open any Feishu page and click the extension icon to bring up the **side panel**.
3. On first use, the top will show **"Configure API keys to get started"** — click it to open "Settings":

![Settings](./screenshots/10-settings.png)

In Settings you need to provide:

| Item | Description |
| --- | --- |
| **Model provider / Base URL / Model** | OpenAI-compatible interface; defaults to the Chinese LLM **DeepSeek**. Can be switched to any compatible service. |
| **API Key** | The LLM's key (`sk-…`). Stored only on this machine, encrypted. |
| **LLM config source** (Enterprise) | When an enterprise pushes a unified config, there's an "Enterprise unified / Manual" toggle here: choosing **Enterprise unified** means **no Key required** — after authorizing with your enterprise Feishu account it is fetched automatically (admins can lock it to enterprise-unified only). The personal edition only has manual config. |
| **Feishu authorization** | Authorize with your Feishu account to obtain a `user_access_token` and `open_id`. The assistant **always operates as you**, never exceeding your permissions. |
| **Theme color / Light-dark mode** | At the top you can toggle light/dark (☀/🌙) and pick a theme color. |
| **Gets smarter over time / Voice input / Auto-confirm** | Optional: whether to distill experience from history, whether to enable voice, and whether to skip the second confirmation for destructive operations. |

> 🔒 Security: all keys/tokens are stored encrypted in the local `chrome.storage` and are never uploaded to any server. The permission boundary is **hardcoded in the code** — "file-level deletions" such as deleting an entire table/document are flatly forbidden.

---

## 2. Overall Interface: Chat / Scenarios

The top of the side panel shows the brand name, a **badge for the current page type** (Base / Sheet / Doc / Wiki…), the light-dark toggle, and settings; the bottom has two tabs:

- **Chat** — freely converse with the AI and have it directly operate the current Feishu page.
- **Scenarios** — a one-click capability hub, smart-sorted and grouped by the **page you currently have open**.

When you open a Feishu page: supported resources default to "Chat", while other pages default to "Scenarios".

---

## 3. Chat: Operate Feishu with Natural Language

In "Chat" just state your need directly, e.g. "Create a project management table with name / status / owner / due date." The AI calls roughly 50 tools to perform operations on Base (creating/modifying tables, fields, views, adding/editing/deleting records, structured search), Sheet (reading/writing ranges, filling columns, find and replace, adding/removing rows and columns), and Doc (Markdown to document, inserting content blocks, revising based on comments), and supports deduplication / cross-table lookup / conditional batch updates / table→table aggregation / auditing.

![Chat welcome page](./screenshots/01-chat-welcome.png)

- The first screen offers "what you can do" guidance and one-click examples based on the **current page type**.
- Destructive / batch write operations (delete, `conditional batch edit`, `cross-table backfill`, etc.) pop up a **confirmation card**, and only run after you click to confirm (you can enable "Auto-confirm" in Settings to skip this).
- Click a field/cell in a Feishu table and its text is automatically filled into the input box, making it easy to describe precisely what you want to change.

---

## 4. Scenarios: A Capability Hub Smart-Grouped by the Current Page

"Scenarios" isn't a flat pile of cards — it's **context-aware**: the top status bar shows "Current page: Base / Sheet / Doc…", and below it capabilities are grouped by "what to do", with **capabilities matching the current page ranked first and highlighted, while unavailable capabilities are grayed out, sunk to the bottom as a group, and labeled "Requires…"** — so you don't click in only to find you can't use it.

**On a Base / Sheet page:**

![Scenario hub (table page)](./screenshots/02-hub-base.png)

**On a Feishu Doc page (doc capabilities float to the top, table capabilities sink and gray out):**

![Scenario hub (doc page)](./screenshots/08-hub-doc.png)

Group overview:

| Group | Capabilities | Applicable pages |
| --- | --- | --- |
| Turn data into pages | AI Mini-App, AI Site Builder | Base / Sheet |
| Data processing and analysis | Smart Fill, Data Analysis Report | Base / Sheet |
| Document processing | Document Audit, Document Summary | Feishu Doc |
| Presentation / PPT | **AI Slides** | Doc **or** table |
| Build / set up a Base | Scenario Template Gallery | Any |
| Web capture | Clip / full scrape / screenshot recognition / file import | Any web page (right-click triggered) |

---

## 5. Turn Data into Pages: AI Mini-App / AI Site Builder

> Both are "one sentence turns the current table into a floating page panel" — saveable, and reopenable in one click next time with the latest data; offline, self-contained, no network.

### AI Mini-App

Turn the current table into a **chart / report / dashboard / calculator / slides**, rendered as a floating window on the page. Interactions (filter linkage, search/sort/pagination, editable cell write-back, row-level task creation) are all reliably implemented by the plugin.

![AI Mini-App](./screenshots/04-dataviz-panel.png)

### AI Site Builder

Turn the current table into a **complete website page** (hero section + metrics + charts + details), which can be "exported to a Feishu Doc" or "pushed to a group".

![AI Site Builder](./screenshots/05-aisite-panel.png)

> After generation, a **semi-transparent floating pill appears in the bottom-left corner** of the Feishu page — click it to expand/collapse; saved ones stay there permanently and reopen in one click with new data.

---

## 6. Data Processing and Analysis: Smart Fill / Data Analysis Report

### Smart Fill

Select a column, and the AI infers the **missing values** by referencing the other columns in the same row (categorize / tag / classify / complete), then **writes them back to Base in one click after preview**.

![Smart Fill](./screenshots/06-smartfill-panel.png)

### Data Analysis Report

Reads the current table's data, and the AI writes an analysis report **with real numbers** (summary / key findings / trends / recommendations), automatically generating a Feishu Doc with the source data table attached.

---

## 7. Document Processing: Document Audit / Document Summary

### Document Summary

Reads through the current document and generates a summary per your requirements (abstract / key points / to-dos…). **The summary requirements are customizable and persisted on this machine.**

![Document Summary](./screenshots/09-docsummary-panel.png)

### Document Audit

Reads through the current document, and the AI finds **logical gaps / undefined terms / inconsistencies / leftover TODOs / outdated data / empty sections**, providing a locatable checklist.

---

## 8. 🎞️ AI Slides (Doc/Table to PPT) — Highlight

Take the current **Feishu Doc** or **Base / Sheet**, first summarize / analyze it, then turn it into a **multi-page, flippable PPT** rendered in a floating window on the page — as close to a real PPT as possible. This is one of the output forms of AI Site Builder.

### 8.1 Entry and Generation

On a doc or table page → Scenarios → "Presentation / PPT" → **🎞️ AI Slides**:

![AI Slides panel](./screenshots/03-slides-panel.png)

- You can fill in **extra requirements** (e.g. "focus on conclusions and risks", "keep it within 10 pages", "for management"), then click **Generate slides**.
- The AI first internally summarizes/analyzes the content, then arranges an 8–16 page presentation, automatically choosing layouts: cover, section pages, key points, two-column comparison, key numbers, charts, punchy conclusions.
- The generation process shows real-time progress (N characters generated), a timer, and "Cancel".

### 8.2 Flipping and Playing

After generation, the floating window on the page is a full PPT:

| Action | Method |
| --- | --- |
| Flip pages | `← / →`, `Space`, `PageUp/Down`, `Home/End`; **click the left/right side of the slide**; the `‹ ›` buttons at the bottom |
| Jump to a page | Click the **dots** at the bottom directly |
| Progress | `current / total pages` in the bottom-left |
| **Auto-play** | **▶** at the bottom (flips every 5 seconds, loops; manual flipping resets the timer); click again to turn into **⏸** to pause |
| **Light-dark mode** | **☀ / 🌙** at the bottom toggles in one click (affects only the slides, not the side panel) |
| **Color adjustment** | **🎨** color picker in the floating window's title bar — pick any theme color → PPT/charts/titles/dots recolor in real time; **↺** restores the default. Also applies to websites / dashboards / charts |
| **Export PDF** | **🖨** in the floating window's title bar, exports the whole set "one slide per page" |

**Cover page (light):**

![Slide · Cover](./screenshots/20-slide-title.png)

**A data page presented with charts (more like a real PPT):**

![Slide · Chart page](./screenshots/21-slide-chart.png)

**One-click switch to dark:**

![Slide · Dark](./screenshots/22-slide-dark.png)

### 8.3 Presenting Data with Charts

For data metrics in documents, as well as Sheets / Bases, the AI will **prefer charts** (pie / column / line / bar) to present distributions, proportions, trends, and rankings, instead of dry text — that's what makes it feel like a real PPT. Charts only use numbers that can be derived from the real data — nothing is made up.

### 8.4 Reuse Saved Dashboards (Table-only)

When generating a PPT on a Base / Sheet, your **saved dashboards (AI Mini-App / dashboards)** are automatically appended at the end as slides, rendered live with the latest data — no need to remake the charts.

### 8.5 Adjusting a Specific Page

Not happy with one page? In the panel's "**Adjust a page**" section, fill in the **page number** + a one-sentence request (e.g. "change this page to a pie chart", "trim to 3 bullets", "change the title", "add a concluding line"), then click "Adjust this page" — the AI redoes only that page, leaves the rest untouched, and re-displays it immediately.

### 8.6 Save as a Template, Skip Generation Next Time

After generation, click **⭐ Save** to add it to the panel's "**My presentations**" list (see the screenshot in 8.1). Next time, click a presentation in the list directly to **replay it without calling the LLM, with no generation needed**; table-based presentations automatically refresh their dashboard pages with the latest data.

---

## 9. Build / Set Up a Base: Scenario Template Gallery

One click to set up Bases such as **CRM / e-commerce / project management** (including table structure, sample data, and dashboards). You can configure a remote template gallery URL in Settings to get more.

![Scenario Template Gallery](./screenshots/07-gallery.png)

- Search at the top, filter by category.
- Click a card to enter its detail page, where you can configure parameters, choose "New app / Current Base", then "Start creating".
- The creation process has step-by-step progress, and you can retry on failure.

---

## 10. Web Capture: Clip / Scrape / Recognize / Import

Trigger via right-click on **any web page** to organize the content and write it into Feishu (requires enabling `CLIP_ENABLED` in the build):

| Capability | Trigger |
| --- | --- |
| Web clip | Right-click "Clip to Feishu" → table / selected content is organized by AI and written into a Base / Sheet / Doc |
| Full scrape | Right-click "Clip the whole table (scroll-load all rows)" → scrape all rows of a virtual-scroll table |
| Screenshot recognition | Right-click "Screenshot recognition to Feishu" → a vision model recognizes tables in a canvas / image (requires a configured vision model) |
| File import | **Drag** a CSV / spreadsheet file directly **into the side panel** → AI organizes it and writes it into Feishu |

---

## 11. Frequently Asked Questions (FAQ)

**Q: The side panel says "Please use this on a Feishu page first"?**
A: The assistant only works on Feishu pages (Base / Sheet / Doc / Wiki). Just open the corresponding page; you can also drag in a CSV.

**Q: If I switch to another browser tab and come back, will the generated content be lost?**
A: No. The generation results of AI Mini-App / Site Builder / Slides are cached per page and automatically restored when you come back ("Restored your last generated…"), with no need to redo them; saved ones remain in "My sites / My presentations / dashboard pill".

**Q: For a table opened inside a "Wiki", the floating pill doesn't show?**
A: It's supported — the plugin automatically resolves the Wiki into the real table/document behind it before matching. If it can't recognize it for a long time, just open the document/table itself.

**Q: What do I do if my login expires?**
A: A banner "Feishu login has expired, please log in again" appears at the top — click it to return to Settings and re-authorize; in-progress operations give a clear message and won't falsely report "Please open a table first".

**Q: The PDF exported from the slides is wrong/blank?**
A: Please export using the **🖨** in the floating window's title bar (it also builds a "one slide per page" print version in sync, charts included); what's exported is the slides in the floating window itself, not the rest of the page content.

**Q: Will my data be sent to the LLM?**
A: Only when completing a task you explicitly initiated is the **necessary, capped** data sent to the LLM you configured yourself; each tool result has a character cap to limit the amount sent out. All Feishu reads and writes are performed as you, on demand.

---

### Appendix: Developer Self-Check

| Check | Command | Result |
| --- | --- | --- |
| Type check | `npm run typecheck` | ✅ Passed |
| Unit tests | `npm test` | ✅ 343 passed / 32 skipped |
| UI smoke tests | `npm run test:ui` | ✅ 11/11 passed |
| Production build | `npm run build` | ✅ Success |
| Screenshot generation | `node scripts/capture-screenshots.mjs` | ✅ 13 images → `docs/screenshots/` |
