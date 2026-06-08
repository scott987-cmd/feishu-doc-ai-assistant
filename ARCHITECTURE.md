> 🌐 [English](ARCHITECTURE.en.md) | **中文**

# Architecture（模块与内部细节深入参考）

> 一站式上手见 [`docs/PROJECT.md`](docs/PROJECT.md)，安全逐条见 [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md)，
> 配置全量见 [`.env.example`](.env.example)。本文聚焦**模块结构、工具清单、字段类型、API 实测坑、
> 模板引擎内部**等深水区细节。

## 目录结构

```
src/
├── background/
│   └── index.ts              # Service Worker — 管理侧边栏生命周期
│
├── content/
│   ├── index.ts              # 注入飞书页面：提取 PageContext + 消息路由
│   └── feishu-automation.ts  # DOM 自动化：点击 UI 创建仪表盘，从 URL 提取 block_token
│
├── sidepanel/                # React 侧边栏 UI
│   ├── main.tsx
│   ├── App.tsx               # 根组件：设置加载、tab 切换、context 监听、会话 hook + 抽屉
│   ├── sessions/             # 多会话管理（持久化 + 按文档绑定）
│   │   ├── useSessions.ts    # hook：按 appToken 自动切会话、debounce 落盘、增删改
│   │   ├── store.ts          # chrome.storage.local 分片存储（index + 每会话消息）
│   │   └── logic.ts          # 纯 reducer：find-or-create / 删除回退（可单测）
│   └── components/
│       ├── ChatPanel.tsx     # AI 对话主界面（流式渲染、工具进度）
│       ├── ScenarioPanel.tsx # 模板市场：Gallery → Detail → Progress → Done
│       ├── BaseContextBadge.tsx  # Base 结构徽章 + 导出模板按钮
│       ├── Settings.tsx      # API Keys 配置 + 外观（主题色）
│       ├── MessageList.tsx   # 消息渲染
│       ├── InputBar.tsx      # 输入框
│       ├── Skeleton.tsx      # 骨架屏（Skeleton / TemplateCardSkeleton）
│       ├── ConfirmDialog.tsx # 新建 Base 确认弹窗（新建/加到当前/取消）
│       ├── ChoiceDialog.tsx  # 通用选项卡弹窗（ask_user 工具：LLM 生成问题+选项让用户选）
│       ├── SessionDrawer.tsx # 会话列表/切换/新建/重命名/删除抽屉
│       └── NetworkBlocked.tsx
│
├── shared/
│   ├── ai/
│   │   ├── agent.ts          # Agent 循环（流式调用 + 工具执行 + 安全校验）
│   │   ├── agent.test.ts     # 纯安全逻辑单测（sanitizeToken / 确认门控 / 截断）
│   │   └── tools.ts          # 25 个飞书工具定义（含破坏性工具警告标记）
│   │
│   ├── feishu/
│   │   ├── api.ts            # 多维表格 Base Open API（表/字段/记录/视图/仪表盘/转所有者）
│   │   ├── http.ts           # 共享请求层 feishuReq（sheets/docx 复用）
│   │   ├── sheets.ts         # 电子表格 Spreadsheet API（建表/工作表/单元格读写追加）
│   │   ├── docx.ts           # 文档 Docs API（建文档/读正文/列块/插块/删块；buildBlock + markdownToBlocks + insertTable）
│   │   ├── compose.ts        # 复合操作（原生缺失）：fetchAllRecords/searchAllRecords + summarizeTable + tableToSheet + dedupeRecords + crossTableLookup + updateWhere + auditTable
│   │   ├── auth.ts           # resolveToken（只用 user_access_token）+ getValidUserToken（自动续期）+ isPermissionError
│   │   ├── appSecret.ts      # 密码加密 App Secret 的运行时解锁（PBKDF2+AES-GCM）
│   │   ├── oauth.ts          # 扩展内 OAuth（launchWebAuthFlow → user_access_token → user_info）
│   │   ├── context.ts        # Base 结构加载（最多 6 张表并发，含字段/视图/选项）
│   │   └── export.ts         # Base → 模板 JSON 导出（ID 替换为符号引用）
│   │
│   ├── templates/
│   │   ├── types.ts          # ScenarioTemplate / ProgressStep / CreationResult 类型
│   │   ├── engine.ts         # 模板执行引擎（建表 → 视图 → 数据 → 仪表盘）
│   │   ├── registry.ts       # 远程模板拉取（HTTPS 强制）+ 1h localStorage 缓存
│   │   ├── builtin/          # 内置模板（电商 / 项目管理 / CRM）
│   │   └── index.ts
│   │
│   ├── providers.ts          # LLM 供应商预设（国内优先：DeepSeek 默认 / Qwen / GLM / Kimi；海外 OpenAI 可选）
│   ├── theme.ts              # 主色派生 deriveAccent（单 hex → 整套品牌 CSS 变量，含暗色变体）
│   ├── crypto.ts             # AES-256-GCM 加密（per-device key + 自动迁移）
│   ├── network.ts            # CIDR 访问控制（WebRTC 本地 IP 检测）
│   ├── network.test.ts       # ipInCidr 单测（/8 /24 /32 /0 + 边界）
│   ├── config.ts             # 构建时常量（env vars → 类型安全对象）
│   └── types.ts              # 公共类型（AppSettings / PageContext / ChatMessage）
│
└── dev/
    ├── chrome-mock.ts        # dev:ui 模式下 Chrome API mock（localStorage 持久化）
    └── scenarios.ts          # 开发场景切换（base / nonBase / withSelection）

public/
└── templates/
    ├── index.json            # RegistryIndex — 本地测试市场索引
    └── hr.json               # 人员管理系统（测试模板）
```

---

## 设计系统 / 主题

- 所有颜色/圆角/阴影/渐变集中在 `App.css` 的 `:root` CSS 变量(`--color-*` / `--gradient-brand` / `--shadow-*` / `--ring`),组件全部引用变量 → 改 token 即全局换肤。
- **暗色模式**:`App.tsx` 维护 `theme`('light'|'dark'),写入 `document.documentElement.dataset.theme` 并持久化到 `localStorage['fa-theme']`;`App.css` 的 `[data-theme="dark"]` 覆盖 token + 少量硬编码浅色填充。头部月亮/太阳按钮切换。
- 品牌色为靛蓝→紫渐变(`--gradient-brand`),用于 Logo、标题、主按钮、用户气泡。
- **主色可配置**:`src/shared/theme.ts` 的 `deriveAccent(hex,isDark)` 把单个 accent hex 派生成整套品牌变量(primary/hover/soft/tint/border/gradient/ring + 6 个 `--shadow-brand-*`)。`App.tsx` 持有 `accent` state(localStorage `fa-accent`,与 `fa-theme` 对称),`useEffect([accent,theme])` 把变量写到 `:root`;`accent===DEFAULT_ACCENT` 时**清除** inline 覆盖、回落到 App.css 手调默认值。Settings「外观」节给预设色板 + `<input type=color>`,即时生效不走 chrome.storage。**注意**:所有品牌色已收敛为变量,组件内不再有硬编码 `rgba(79,107,255)`/`rgba(123,92,255)`,新增 UI 一律引用变量,否则自定义主色不生效。
- **骨架屏**:`components/Skeleton.tsx`(`Skeleton` + `TemplateCardSkeleton`),shimmer 动画在 `Skeleton.css`。ScenarioPanel 首次远程拉取(`refreshing && templates===BUILTIN_TEMPLATES`)时列表显示骨架卡。
- **视图转场**:`.view-enter`(App.css `viewIn` keyframes)。Tab/Settings 切换在 `App.tsx` 用 `.app-view` keyed wrapper(`key=showSettings?'settings':tab`)触发;ScenarioPanel 的 gallery/detail/progress/done 各根元素带 `key` + `view-enter`。
- **模板封面图**:`ScenarioTemplate.cover?`(可选)。`TemplateCard` 有 cover 则渲染 `<img class=sc-card-cover>`,`onError` 降级回 emoji icon;无 cover 直接用 emoji。`hr.json`/`index.json` 用内联 SVG data-URI 做示例(同源、免 CDN/CSP)。
- 动效尊重 `prefers-reduced-motion`:`MessageList.css`(msg-row 等)、`App.css`(`.view-enter`/`.skel`)、`Skeleton.css`(`.skel`)各自关闭。

## 会话管理（多会话 / 按文档绑定）

会话持久化到 `chrome.storage.local`，**按文档自动绑定**：切到某飞书 Base 文档，侧边栏自动打开该文档记录的会话；非 Base 页面用「通用会话」。

- **存储分片**：`sessions_index_v1`（轻量索引 `SessionIndex`：sessions/activeId/byAppToken/generalId）+ `session_msgs_v1::<id>`（每会话消息，懒读、debounce 800ms 写）。见 `sessions/store.ts`。
- **状态提升到 App**：会话状态在 `App` 的 `useSessions(activeAppToken, streaming)` hook 里（不放 ChatPanel——它随 tab 切换会卸载）。`ChatPanel` 改为受控：`messages`/`setMessages` 由 hook 提供。
- **自动切换**：hook 监听 `ctx.feishu.appToken` 变化 → `find-or-create` 对应会话并加载其消息。**streaming 期间延迟切换**（回复完才跟随浏览器导航），避免把流式 chunk 写进别的会话。
- **标题 = 文档名**：新建文档会话先用 `文档 <token前8位>…` 占位，`ChatPanel` 的 `fetchBaseCtx` 拿到 `appName` 后 `resolveTitle(appToken, name)` 回填（用户手动重命名后不再被覆盖）。
- **纯逻辑**：`sessions/logic.ts` 的 `ensureSession`/`removeSession` 是无副作用 reducer（find-or-create、byAppToken 维护、删除回退到当前文档/通用会话），有单测 `logic.test.ts`。
- **UI**：`ChatPanel` 顶部「会话条」显示当前标题、点开 `SessionDrawer`（列表/切换/新建/重命名/删除，按 updatedAt 排序，文档会话 📄、通用 💬）。streaming 时禁切。
- **dev**：`chrome-mock.ts` 补了 `storage.local.remove`；存储照旧持久化到 localStorage，刷新不丢。

## 消息协议

所有消息均校验 `sender.id === chrome.runtime.id`，拒绝外部来源。

```
Side Panel ──chrome.tabs.sendMessage──▶ Content Script
                                              │
         ◀──────────sendResponse─────────────┘

  GET_PAGE_CONTEXT     → PageContext { url, appToken, tableId, viewId, selectedText }
  CREATE_DASHBOARD_UI  → { blockToken: string, created: boolean }（DOM 自动化）

Content Script ──chrome.runtime.sendMessage──▶ Side Panel
  PAGE_CONTEXT_UPDATE  → PageContext（SPA 导航时推送）
```

---

## AI Agent 设计

### 执行流程

```
用户消息
  │
  ▼
buildSystemPrompt()          # 注入角色定义、作用域、当前 Base 结构
  │
  ▼
OpenAI Streaming API
  │
  ├─ text chunk → onChunk() → 流式渲染
  └─ tool_calls
       │
       ▼
  checkDestructiveConfirmation()   # 破坏性工具：扫描用户消息确认词
       │
       ▼
  sanitizeToken()                  # 所有 ID 参数正则校验 [A-Za-z0-9_-]
       │
       ▼
  executeTool() → 飞书 API
       │
       ▼
  truncateToolResult(8KB)          # 截断防 PII 外泄
       │
       ▼
  结果回填 msgs[] → 下一轮循环
       │
  MAX_TOOL_CALLS=20 → 超出停止
```

### 交互式弹窗（让 agent 把不确定的事交还用户）

两个入口，都靠「runAgent 在工具循环里 `await` 一个可选回调 → ChatPanel 用 `pending* state + Promise` 实现弹窗 → 按钮点击 resolve」这套机制：

1. **新建 Base 确认** —— `requestConfirmation?(req): Promise<'new'|'current'|'cancel'>`。runAgent 执行 `create_bitable_app` 前 await，让用户选 新建独立 Base / 加到当前 Base / 取消。选「加到当前」→ 工具返回 `{_use_current, app_token}` 引导后续 `create_table` 改用当前 app；「取消」→ `{_cancelled}`。组件 `ConfirmDialog`。
2. **ask_user 通用选项卡** —— `askUser?(req): Promise<string>`，由 **`ask_user` 工具**驱动：LLM 觉得意图不明/缺信息/多方案需拍板时，自己生成 `question` + 2-4 个 `options`（label/description）调用它，runAgent 拦截（不走 executeTool）→ await `askUser` → 把用户选中的 label 作为 `{user_choice}` 回传，agent 据此继续。组件 `ChoiceDialog`（复用 `ConfirmDialog.css`）。

两个回调都**可选**：harness/测试不传时，`create_bitable_app` 按「新建」直接执行、`ask_user` 返回 `{_no_ui}` 提示 agent 改用文字询问——都不会卡住。系统提示词第 1.5 条引导 agent「拿不准就用 ask_user」。

### 工具列表（53 个，跨 3 个产品）

**多维表格 Base（33）**
| 分类 | 工具 |
|------|------|
| App | `get_app_info` `create_bitable_app`（以用户身份创建，直接归用户、无需转交）|
| 表 | `list_tables` `create_table` `delete_table` ⚠️ |
| 字段 | `list_fields` `create_field` `update_field` `delete_field` ⚠️ |
| 记录 | `list_records` `create_record` `batch_create_records` `update_record` `batch_update_records` `search_records` `delete_record` ⚠️ `batch_delete_records` ⚠️ |
| 视图 | `list_views` `create_view` |
| 仪表盘 | `list_dashboards` `copy_dashboard`（整盘复制，唯一可用写操作）|
| 报告 | `base_to_doc_report`（读 Base 结构 → 生成汇总文档，内容生成非导出）|
| 复合（原生缺失/多步联动）| `summarize_table`（分组聚合/数据透视 → 新电子表格）`base_table_to_sheet`（Base 表 → 电子表格）`dedupe_records` ⚠️（按关键字段去重）`cross_table_lookup`（跨表 VLOOKUP 回填）`update_where`（按条件批量改）`audit_table`（数据质量体检 → 报告）|

**电子表格 Spreadsheet（13）** — `spreadsheet_token` + `range`("{sheet_id}!A1:C10")，scope `sheets:spreadsheet`

> **公式（实测修正）**：飞书把纯 `"=A2*B2"` 字符串当**文本**存（不计算），真公式须写成 `{type:'formula',text:'=...'}`。`sheets.ts` 的 `normalizeCell` 自动把 `=` 开头的字符串转成公式对象，所以 `write_range`/`append_rows` 直接传 Excel 语法即可。读取时 `read_range` 用 `valueRenderOption=FormattedValue`，否则默认/ToString 会返回公式表达式（"A2*B2"）而非计算结果。range 不接受裸单格（用 `C2:C2` 不能用 `C2`）。
| 分类 | 工具 |
|------|------|
| 表格 | `create_spreadsheet` `get_spreadsheet` |
| 工作表 | `list_sheets` `add_sheet` `delete_sheet` ⚠️ |
| 单元格 | `read_range` `write_range` `append_rows` `fill_column`（整列公式填充）`find_replace` `set_number_format` |
| 行列 | `insert_dimension` `delete_dimension` ⚠️ |

**文档 Docs（6）** — `document_id`，scope `docx:document`
| 分类 | 工具 |
|------|------|
| 文档 | `create_document` `create_doc_from_markdown`（★ Markdown 一键成文）`get_document_content` |
| 块 | `list_blocks` `add_document_content`（段落/标题/列表/引用/代码/待办/分割线）`insert_table`（建表格并填内容）`delete_document_blocks` ⚠️ |

> **Markdown → 文档**（`docx.ts` 的 `markdownToBlocks` + `createDocFromMarkdown`）：解析 # 标题、-/* 列表、1. 有序、> 引用、```代码```、--- 分割线、- [ ] 待办，及内联 `**粗**`/`*斜*`/`` `码` ``。块类型码均已 live 验证（text2 / h1-3=3-5 / bullet12 / ordered13 / code14 / quote15 / todo17 / divider22）；注意 quote 的字段名是 `quote` 不是 `quote_container`。

**Base 复合工具（原生缺失/多步联动，2026-05 新增）** — 均在 `compose.ts` 实现，读全量记录后本地计算，写回经飞书 batch 接口（单批上限 500，`compose.ts` 内 `chunk` 自动分批；读全量 cap=5000，返回带 `capped` 标志）：

| 工具 | 说明 |
|------|------|
| `dedupe_records` ⚠️ | 按 `key_fields` 组合去重：分组→每组保留 first/last→批量删其余。**破坏性**，建议先 `dry_run=true` 预览 `duplicate_groups`/`to_delete` 再确认 |
| `cross_table_lookup` | 跨表 VLOOKUP：用源表键去目标表匹配，把目标列回填源表 `into_field`（不存在则自动建文本列）。多命中按 `on_multiple`=first/join/skip 处理，返回 `filled`/`unmatched`/`multi_hit` |
| `update_where` | 按条件批量改：`search_records` 全量命中→对每条写 `set`→`batch_update`。支持 `dry_run` 预览命中数 |
| `audit_table` | 数据质量体检：检 `required_fields` 空缺、`unique_fields` 重复、`numeric_outlier_fields` 的 3σ 离群值。`output=doc` 时经 `renderAuditMarkdown`+`create_doc_from_markdown` 生成报告文档 |

> 三种产品 token/工具不可混用；非 Base 工具在 `executeTool` 里经 `SHEET_TOOLS`/`DOC_TOOLS` 分发，绕开 Base 的 `app_token` 守卫。`cross_table_lookup` 的 `source_table_id`/`target_table_id` 不叫 `table_id`，case 内单独 `sanitizeToken`。

⚠️ = 破坏性工具，需用户明确确认才执行。

---

## 安全设计

> 权限边界**全部硬编码在代码里**（提示词不作安全边界）。逐条审计 + 攻击场景见
> [SECURITY_AUDIT.md](SECURITY_AUDIT.md)；这里只列代码层卡点的落点。

| 卡点 | 位置 | 作用 |
|------|------|------|
| 身份 = 用户本人 | `auth.ts resolveToken` | 只用 user_access_token，不回退 tenant（权限不超用户） |
| 禁文件级删除 | `agent.ts isFileLevelDelete`（loop + executeTool 双重） | 整表/电子表格/文档/`feishu_api_call` DELETE 一律拒；内容级删除走确认门 |
| 删除/写确认门 | `agent.ts` 破坏性门 | 内容删除/写弹按钮确认；**Auto 模式**(`settings.autoConfirm`)自动确认；文件级不受影响 |
| 通用 API 白名单 | `agent.ts assertApiCallAllowed` | 默认拒绝 + 硬阻断 消息/通讯录/权限/所有权 + 路径穿越 |
| 出站锁定 | `config.ts isFeishuOutboundAllowed` + `providers.ts assertSafeBaseUrl` + CSP | 只准连飞书(基础域名子域) + 大模型；私有化可纯内网 |
| 上下文来源 | `App.tsx onMessage` | 只接受**当前窗口 active tab** 的 PAGE_CONTEXT_UPDATE（防后台 tab 串扰） |
| 工具调用上限 | `agent.ts` | 每轮默认 30(可配 `VITE_MAX_TOOL_CALLS`)，到顶停下让用户确认继续 |
| 凭据加密 | `crypto.ts` | AES-256-GCM，密钥 = PBKDF2(扩展ID + 每设备随机 seed)；加密 token/secret |
| App Secret | `appSecret.ts` | 明文 / 密码加密(PBKDF2→AES-GCM) / 代理 三档 |
| 数据最小化 | `agent.ts truncateToolResult` | 传给 LLM 的工具结果截断 8KB，防 PII 批量外泄 |

---

## 模板系统

### 市场架构

```
构建时注入 VITE_DEFAULT_REGISTRY_URL
  │  effectiveUrl = settings.templateRegistryUrl || DEFAULT_REGISTRY
  ▼
registry.ts
  ├─ 校验 URL（HTTPS 或相对路径）
  ├─ fetch {url}/index.json → RegistryIndex
  ├─ 并发 fetch 各 template.json
  └─ localStorage 缓存 1h
  │
  ▼
mergeTemplates()             # 远程同 id 覆盖内置
  │
  ▼
ScenarioPanel Gallery        # 模板市场 UI（一键导入）
```

### URL 优先级

| 优先级 | 来源 |
|--------|------|
| 1（最高）| Settings 中用户填写的地址 |
| 2 | 构建时 `VITE_DEFAULT_REGISTRY_URL` |
| 3 | 无远程，仅显示内置模板 |

### 符号引用

模板 JSON 中用符号代替真实 ID，引擎建表后解析：

```
"__tbl:{ref}__"              → 真实 table_id
"__fld:{tableRef}:{name}__"  → 真实 field_id
```

### 模板执行顺序

1. 创建/复用 App
2. 按序创建表
   - 先建非公式字段
   - 再建公式字段（依赖其他字段存在）
   - 列出字段 ID，构建 `fieldIdMaps`（用于仪表盘符号解析）
3. 创建视图
4. 批量导入示例数据
5. 配置仪表盘

### 仪表盘能力的真实边界（2026-05 实测修正）

⚠️ **此前文档高估了 API 能力。实测飞书 bitable OpenAPI 的仪表盘接口只有两个：**

| 操作 | 端点 | 实测 |
|------|------|------|
| 列出仪表盘 | `GET .../dashboards` | ✅ 真实（返回名字 + block_id）|
| 复制仪表盘 | `POST .../dashboards/{id}/copy` | ✅ 真实（无写权限时返回 91403，非 404）|
| 读图表 block | `GET .../dashboards/{id}/blocks` | ❌ **404 不存在** |
| 建图表 block | `POST .../dashboards/{id}/blocks` | ❌ **404 不存在** |

**后果**：`api.ts` 的 `getDashboardBlocks` / `createDashboardBlock` 调用必 404，且在 `engine.ts:248` 与 `export.ts:151` 被 `catch` 静默吞掉 —— 所以：
- 模板引擎从未真正创建过任何图表（`dash.blocks` 循环每次都失败，只是不报错）；
- 导出模板时仪表盘的 `blocks` 永远是 `[]`（读不到）。

**正确路线**：程序化"逐个建图表"不可能。要复刻仪表盘只能 **`copyDashboard` 整盘复制**（需对 Base 有编辑权），或走 **DOM 自动化**（仅浏览器内、用户停在该 Base 页时可用）。

> 待办（需决策，会改模板格式）：把模板引擎/导出从"block 配置"模式改为"copy 源仪表盘"模式，并移除两个 404 死函数的调用点。

---

## AI 小程序 / Data App（沙箱小程序）

把当前多维表格/电子表格的数据，用一句话（或对话）做成飞书页面上的悬浮窗**小程序**——同一套 codegen+沙箱管线产出五类：
**图表看板**(ECharts) · **计算器/交互工具** · **可打印报表**(`window.print()`) · **汇报幻灯片** · **卡片墙/时间线等自定义视图**。
全部纯靠提示词区分（同一运行时 globals：`data / echarts / container / theme`）。生成的是**只读渲染**代码——不写飞书（写表交给 Smart Fill / 对话工具）。

**数据流（4 个上下文）**

```
侧边栏(有 chrome.*/token/LLM key)
  generateViz() 一次性 codegen → {name, code}          // 生成小程序代码
  fetchVizData() listRecords/readRange → {schema, rows} // 拉实时数据
  chrome.tabs.sendMessage(tabId, {DATAVIZ_RENDER, vizId, code, data})
  ↓
内容脚本(*.feishu.cn)：注入可拖拽/四角缩放浮窗 + 沙箱 iframe；按 vizId 多实例；
  iframe.postMessage({code,data,nonce})；回 RENDER_OK/ERR → 转回侧边栏
  ↓
沙箱页(src/sandbox，MV3 sandbox.pages)：null 源、无 chrome.*、connect-src 'none'；
  内置 ECharts(treeshake，仅此包)；new Function 执行生成代码渲染
```

- **代码与数据分离**：保存的是 `render(data,echarts,container,theme)` 代码（`SavedViz`，存 `chrome.storage.local`）；
  数据每次**实时重拉**。所以「我的小程序」重开 = 拉新数据 + 跑旧代码，**零 LLM、数据永远最新**。
- **触发**：场景 hub「🧩 AI 小程序」按钮 + 对话工具 `render_data_app`；**调整 = 对当前代码做最小改动**——把现有代码回传给模型，只改用户点名的那一处、其它图逐字保留（多图看板里不会"改一个图把整盘都重排了"）。
- **多实例**：一页可挂多个独立小程序（各自浮标、各自浮窗、可同时打开）；单看板内可含多图（CSS Grid，多个 echarts 实例）。

**安全**：生成的是 LLM 代码，但跑在锁死的沙箱里 —— `connect-src 'none'`（**拿了数据也发不出去**）、null 源（**无 token/storage/chrome.* 访问**）、
与飞书页 DOM 跨源隔离；codegen 走既有 LLM 端点（无新增出站）；另有 `fetch|import|WebSocket` 静态拒绝兜底。沙箱**只读渲染、不回写飞书**。详见 SECURITY_AUDIT「M9」。

**容量（实测量级，非硬上限）**

| | 量级 | 说明 |
|---|---|---|
| **保存的看板** | 数百个 | 只存代码+绑定(每个 ~5–20KB)，受 `chrome.storage.local`(~10MB) 约束，几乎不设限 |
| **同时打开的浮窗** | 约 5–10 个舒适 | 每个是独立沙箱 iframe（各带一份 ECharts 运行时 + canvas，约 10–20MB/个）→ **RAM 决定**，不是硬上限 |
| **单看板内的小图** | 4–9 个最佳，~12 仍可 | 每个 `echarts.init` 一块 canvas；再多则窗内拥挤、性能下降 |
| **浮标** | 几十个无压力 | 纯 DOM 按钮 |

> 关键点：**没打开的看板几乎不占资源**（只是存的代码）；真正吃内存的是"同时打开几个浮窗"。需要更省可只开当前要看的、看完关掉。

---

## AI 智能填充 / Smart Fill

在**多维表格 / 电子表格**里选一列，AI 参考同行其它列（+ 已填好的行作示例）推断该列**空缺**的值，预览后写回。返回的是**结构化值**（不是代码），所以**全程在侧边栏本地**完成——无沙箱、无内容脚本、无后台中转。

**数据流（全部 side-panel-local）**
```
读：fetchFillContext(source) —— Base: listFields(类型/选项)+fetchAllRecords(带 record_id，按 id 去重)
                              Sheet: readRange(表头=字段，行号=写键，列均按文本)
     按目标列把行分成「空缺=待填」/「已填=示例」
推断：分批(每批~40行)送 LLM —— schema+选项 + K 条示例 + 待填行(各带稳定 key)
     → inferFills() 解析 {fills:[{key,value}]} → Map<key, 原始值>
校验：coerceValue() 按字段类型强制——单选/多选必须命中已有选项(否则跳过、绝不新建)、
     数字/日期解析失败即跳过；key→写键(record_id / 行号)本地映射(模型从不见写键、不靠顺序)
预览：组装 FillPlan（proposed[] + skipped[]）渲染——此步绝不写
应用：applyPlan() → resolveToken，按 source 分流：
     Base  → batchUpdateRecords（分批500，按 record_id 去重、**按 data.records 实计数**、不虚报）
     Sheet → 重读目标列区间→只覆盖仍为空的单元格→writeRange 一次写回（不碰其它单元格）
     仅 update、以用户身份、只动当前表/表页
```

- **只填空白**（默认）：`覆盖已有值` 开关默认关；空缺判定用 `cellToString().trim()===''`（与 `auditTable` 一致）。
- **真实计数**：Base 写入数取自飞书返回的 `data.records`（飞书可能 code 0 却只生效一部分）；少于申请数即如实报「N 处未写入」，再次预览补齐。
- **可填类型**：Base 文本/数字/单选/多选/日期/勾选/电话/链接（公式/查找/自动编号/关联/附件/人员/系统字段排除）；Sheet 各列按文本。
- **大表**：单次预览 inferred 上限 ~300 行，应用后再次预览即接着填余下；读 cap 5000。
- **与 AI 小程序的对比**：小程序要把**生成的代码**关进沙箱执行（执行不可信代码是威胁）；智能填充只产出**值**，
  写回走的就是 `updateWhere`/`crossTableLookup` 同一条合规写路径，所以省掉了整套沙箱/中转。详见 SECURITY_AUDIT「M11」。

---

## 鉴权与身份模型（安全核心）

> 早期版本用应用(tenant)身份创建、再转交给用户。**现已改为：助手始终以用户本人
> `user_access_token` 操作**，不使用 tenant 身份。这同时满足三条根本原则——逐条见
> [SECURITY_AUDIT.md](SECURITY_AUDIT.md) 的「〇、核心操作策略」。

- **P1 创建归属用户**：以用户身份创建 → 新建文档**直接归用户**，无需转交。
- **P3 权限不超用户**：`auth.ts resolveToken()` **只返回 user_access_token**（无 tenant 分支）；
  用户读不了的文档助手也读不了；权限错误如实上报，不回退 tenant。
- **OAuth 自动续期**：Settings「用飞书账号授权」→ `oauth.ts` 走 `chrome.identity.launchWebAuthFlow`
  （manifest `identity` 权限）→ `authen/v2/oauth/token` 换 user_access_token + refresh_token
  （加密存储，到期前 5 分钟自动续期，见 `getValidUserToken`）→ `user_info` 拿 open_id。
- **重定向 URL**：`chrome.identity.getRedirectURL()` = `https://<ext-id>.chromiumapp.org/`，
  登记到应用「安全设置 → 重定向 URL」。
- **App Secret 三档**（构建时选其一）：明文 `VITE_FEISHU_APP_SECRET`（进包）/ 密码加密
  `VITE_FEISHU_APP_SECRET_ENC`（`scripts/encrypt-secret.mjs` 生成，运行时输密码解锁）/
  OAuth 代理 `VITE_OAUTH_PROXY_URL`（secret 不进包，见 `docs/oauth-proxy-worker.js`）。

## 字段类型速查

| type | 名称 | type | 名称 |
|------|------|------|------|
| 1 | 文本 | 13 | 电话 |
| 2 | 数字 | 15 | URL |
| 3 | 单选 | 17 | 附件 |
| 4 | 多选 | 20 | 公式 |
| 5 | 日期（Unix ms）| **1005** | **自动编号** |
| 7 | 复选框 | 1001–1004 | 系统字段（只读）|
| 11 | 人员 | 18/19/21 | 单向关联 / 查找引用 / 双向关联（需 property，模板暂不支持）|

> ⚠️ **自动编号是 `1005`，不是 `21`**（21 是双向关联 DuplexLink）。早期 `api.ts` 枚举曾把 21 误标为 AutoNumber，导致 hr 模板「工号」字段建表报 `code=800074092 DuplexLink field property is null`，已修正。关联/查找类（18/19/21）需 `property` 指向目标表，引擎会跳过此类无 property 字段。

> **公式字段（type=20）**：在字段对象上传 `formula_expression`，用**被引用字段的准确名称**直接写表达式（如 `数量*单价`）。⚠️ 必须用字段名，不能用 `CurrentValue.[…]` 或字段 ID（实测那样会建出空公式、记录值为 null）。建表时把公式字段排在它依赖的字段之后。`create_field` / `create_table` 工具均已暴露该参数。

---

## 环境变量汇总

全部构建时变量（个人 / 企业 SaaS / 私有化 三种部署）见 [`.env.example`](.env.example)
与 [`docs/PROJECT.md`](docs/PROJECT.md) §9——含 App Secret 三档、OAuth 代理、私有化基础域名、
大模型 host 白名单、设备 CIDR 门、工具调用上限等。

---

## 开发指引

### 调试 UI（无需加载扩展）

```bash
npm run dev:ui
# 打开 http://localhost:5173/dev.html
# 浏览器控制台可用 scenarios.base() / scenarios.nonBase() 切换场景
```

### 调试扩展

```bash
npm run dev:ext
# 在 chrome://extensions 加载 dist/，代码变更自动重载
```

### 新增模板

1. 在 `public/templates/` 创建 `{name}.json`（遵循 `ScenarioTemplate` 类型）
2. 在 `public/templates/index.json` 的 `templates[]` 添加条目
3. `npm run build` 后重载扩展

### 修改 Agent 工具

- 新增工具：`tools.ts` 添加定义 + `agent.ts` `executeTool()` 添加 case
- 破坏性工具：description 加 `⚠️` 前缀，并加入 `DESTRUCTIVE_TOOLS` Set（当前：`delete_table` / `delete_field` / `delete_record` / `batch_delete_records` / `delete_sheet` / `delete_dimension` / `delete_document_blocks` / `dedupe_records`）
- 所有 ID 参数命名为 `app_token` / `table_id` / `field_id` / `record_id` 以触发 `sanitizeToken` 自动校验

> `update_field`：飞书更新字段 API 要求 body 同时带 `field_name` 和 `type`，而 LLM 通常只传变更项。`executeTool` 会先 `list_fields` 取当前字段，回填缺失的 `field_name`/`type` 后再调用，避免 400。

### 测试

```bash
npm run typecheck    # tsc --noEmit（构建用 esbuild 不做类型检查，类型回归靠这步兜底）
npm run test         # vitest run — 覆盖纯安全逻辑
```

测试范围（纯函数，无需 Chrome/网络）：
- `network.test.ts` — `ipInCidr` 的 CIDR 匹配（含 `/0`、`/32`、地址空间顶端无符号位问题）
- `agent.test.ts` — `sanitizeToken`（注入字符拦截）、`checkDestructiveConfirmation`（精确确认词门控）、`truncateToolResult`（PII 截断）

实跑集成测试（打真实飞书 API，默认跳过）：
- `feishu/live.test.ts` — 经 `executeTool` 跑 create_table / update_field 回填 / delete_table / 批量记录读写
- 需应用开通 `bitable:app`（应用身份），凭证读自 `feishu-app-config.txt`
- 运行：`FEISHU_LIVE=1 npx vitest run src/shared/feishu/live.test.ts`
- 随时自检权限是否生效：`node scripts/check-perm.mjs`

模板复刻 harness（端到端跑真实 Agent：DeepSeek + 飞书 API，默认跳过）：
- `harness/` — 用自然语言驱动 `runAgent`，复刻多维表格模板并核对字段/类型
  - `driver.ts` — headless 驱动（mint tenant token、注入 DeepSeek 设置、读回结构）
  - `templates.ts` — 10 个不同领域的模板规格（NL prompt + 期望字段）
  - `replicate.test.ts` — 跑全部 10 个并评分，报告写入 `harness-report.txt`
  - `rich.test.ts` — 硬核复刻探针（公式字段 + 示例数据 + 看板视图）
- LLM 配置读自 `deepseek-v4-pro.txt`（base_url / api_key），模型默认 `deepseek-v4-pro`，可用 `LLM_MODEL` 覆盖
- 运行：`REPLICATE_LIVE=1 npx vitest run src/harness/replicate.test.ts`
- 实测结果：10/10 模板字段覆盖 100%；硬核探针验证公式字段实际可计算