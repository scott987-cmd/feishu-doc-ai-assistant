import type { AppSettings } from '../types'
import { NO_REMOTE_CODE } from '../config'
import type { VizField } from '../dataviz/types'
import type { VizSpec } from '../dataviz/spec'
import { validateSpec, referencedFields } from '../dataviz/spec'
import { chatComplete, chatCompleteStream } from './llm'
import { stripFences as fences } from './text'
import { sanitizeForLlm } from './redact'

/** Declarative-spec prompt (no-remote-code build): the model emits a VizSpec (DATA), which the
 *  bundled interpreter renders — no JS is generated or executed. */
function buildSpecPrompt(schema: VizField[], sampleRows: Record<string, string>[], request: string): string {
  return (
    `你是"数据看板生成器"。根据【字段】【样本数据】【需求】，输出一个 JSON：{"title":"简短标题","spec":<规格>}。\n` +
    `spec 是**声明式规格(不是代码)**，按需求选一种 kind：\n` +
    `· 单图：{"kind":"chart","title":"","chartType":"bar|line|pie|scatter","series":{"dimension":"分组字段","measure":{"op":"count|sum|avg|min|max|countDistinct","field":"数值字段(count 可省)"},"sort":"value-desc","limit":20},"axis":{"rotateLabels":true,"scale":true}}\n` +
    `· 看板(多指标/多图/可筛选)：{"kind":"dashboard","filters":["字段"…],"kpis":[{"label":"标签","value":{"op":"sum","field":"金额"}}…],"charts":[{"title":"","chartType":"pie","series":{"dimension":"字段","measure":{"op":"count"}}}…],"table":{"columns":[{"key":"真实字段","editable":false}],"pageSize":20}}\n` +
    `· 纯明细表：{"kind":"table","columns":[{"key":"真实字段","label":""}],"pageSize":20,"search":true,"actions":[{"label":"建任务","template":"跟进 {字段} 的 {字段}"}]}\n` +
    `【规则】dimension/field/filters/columns.key 只用【字段】里**真实存在**的字段名；聚合 op 只用 count/countDistinct/sum/avg/min/max；图表类型只用 bar/line/pie/scatter；不编造数据。可选 measure.where 过滤：[{"field":"","op":"eq|ne|gt|gte|lt|lte|contains|in","value":""}]。\n` +
    `只输出那个 JSON 对象本身，不要任何解释、前言或代码围栏。\n` +
    `\n【字段】${fieldList(schema)}\n\n【样本数据（前 ${sampleRows.length} 行）】\n${sanitizeForLlm(JSON.stringify(sampleRows))}\n\n【需求】${request}`
  )
}

/** Declarative-spec SITE prompt: a SiteSpec = static text sections + one dashboard. */
function buildSiteSpecPrompt(schema: VizField[], sampleRows: Record<string, string>[], request: string, planText?: string): string {
  return (
    `你是数据网站生成器。根据【字段】【样本】【需求】，输出 JSON：{"title":"标题","spec":{"kind":"site","title":"页面标题","sections":[{"type":"hero","title":"","subtitle":""},{"type":"section","title":"","body":"纯文本说明"}],"dashboard":<看板规格>}}。\n` +
    `sections 仅**静态文本**(hero/section，body 为纯文本)；数据区全部放进 dashboard。\n` +
    `dashboard 规格：{"kind":"dashboard","filters":["字段"…],"kpis":[{"label":"","value":{"op":"sum","field":"金额"}}…],"charts":[{"title":"","chartType":"bar|line|pie","series":{"dimension":"字段","measure":{"op":"count|sum","field":""}}}…],"table":{"columns":[{"key":"真实字段"}],"pageSize":20}}\n` +
    `【规则】只用真实存在的字段名；op 只用 count/countDistinct/sum/avg/min/max；图表只用 bar/line/pie/scatter；不编造数据。只输出该 JSON，无解释/围栏。\n` +
    (planText ? `【已确认方案】${planText}\n` : '') +
    `\n【字段】${fieldList(schema)}\n\n【样本数据（前 ${sampleRows.length} 行）】\n${sanitizeForLlm(JSON.stringify(sampleRows))}\n\n【需求】${request}`
  )
}

/** Spec edit (minimal change): hand the model the current spec JSON + a change request. */
function buildSpecEditPrompt(previousSpec: VizSpec, request: string, schema: VizField[]): string {
  return (
    `下面是一个数据看板的**当前规格(JSON)**。请按【修改要求】做**最小改动**，其余原样保留。\n` +
    `只用【字段】里真实存在的字段名；保持 kind 与整体结构；只输出 {"title":"标题","spec":<修改后的完整规格>}，无解释/围栏。\n` +
    `【字段】${fieldList(schema)}\n【当前规格】${JSON.stringify(previousSpec)}\n【修改要求】${request}`
  )
}

/** Parse {title, spec} from model output → validated VizSpec. `warning` flags field names the
 *  model referenced that don't exist in the real table (their widgets will render empty). */
function parseSpec(out: string, schema: VizField[]): { name: string; spec: VizSpec; warning?: string } {
  let parsed: { title?: string; name?: string; spec?: unknown }
  try { parsed = JSON.parse(out) } catch { throw new Error('模型输出不是有效 JSON，无法解析可视化规格。请重试或换一个支持 JSON 输出的模型。') }
  const spec = validateSpec(parsed.spec, schema.map((f) => f.name))
  const known = new Set(schema.map((f) => f.name))
  const unknown = referencedFields(spec).filter((f) => !known.has(f))
  const warning = unknown.length
    ? `这些字段名没匹配到表里的列：${unknown.join('、')}（相关图表/指标可能显示为空）。可点重试或换种描述。`
    : undefined
  return { name: (parsed.title || parsed.name || '可视化').slice(0, 40), spec, warning }
}

/**
 * One-shot codegen: given a table schema + a small sample of rows + a natural-language
 * request, ask the LLM for a render-function body that builds an ECharts chart. The code is
 * the SAVED artifact; data is injected live at render time. Same client/guard as vision.ts —
 * no new egress. The code runs only inside the locked sandbox (connect-src 'none').
 */

/** Defense-in-depth on top of the sandbox CSP: reject obvious network/import calls. */
export function hasForbiddenCalls(code: string): boolean {
  return /\b(fetch|XMLHttpRequest|importScripts|WebSocket|EventSource|sendBeacon|localStorage|indexedDB)\b/.test(code)
    || /\bimport\s|\brequire\s*\(/.test(code)
}

/** Model-facing field list: 名（类型）｜样本: a, b, c — the real sample values let the model
 *  see actual formats (date layout, currency style with ¥/$, option labels) instead of guessing. */
function fieldList(schema: VizField[]): string {
  return schema.map((f) => `${f.name}（${f.type}）${f.samples?.length ? `｜样本: ${f.samples.join(', ')}` : ''}`).join('\n')
}

/** Type-aware charting/format guidance for the site prompt (only applies to fields that exist). */
const TYPE_HINTS =
  `【按字段类型选图与格式化（只对【字段】里真实存在的字段套用）】\n` +
  `  · DateTime / CreatedTime / ModifiedTime → 解析后按时间排序做时间序列（折线/面积）；\n` +
  `  · SingleSelect / MultiSelect / Checkbox → 作筛选维度或分组（饼 / 堆叠柱）；\n` +
  `  · Person / CreatedBy / ModifiedBy → 按负责人维度聚合排名；\n` +
  `  · Number（样本带 ¥/$ 视为货币、Percent 为百分比）→ 进 KPI 与数值轴，按样本格式展示，数值都远大于 0 时数值轴 {scale:true}；\n` +
  `  · SingleLink / DuplexLink / Lookup → 关联字段，可与对应子表（datasets）按共同键 join。\n`

function buildPrompt(schema: VizField[], sampleRows: Record<string, string>[], request: string): string {
  const schemaText = fieldList(schema)
  return (
    `你是一个"AI 小程序生成器"。根据【字段】【样本数据】和【需求】，生成一个嵌在飞书页面浮窗里的自包含小程序。\n` +
    `输出一个 JSON 对象：{"title": "简短标题", "code": "..."}。code 是构建界面的 JS（可以是直接写语句的"函数体"，` +
    `也可以是完整的 function render(data, echarts, container, theme){...} 或箭头函数，都行），运行时可用：\n` +
    `  - data：完整数据数组（每项一行对象，键=字段名，值是字符串，数字用 Number() 转）。\n` +
    `  - echarts：ECharts 模块。  - container：根 DOM 容器（已撑满浮窗，宽高 100%，可随意 appendChild/设样式）。\n` +
    `  - theme：'light' 或 'dark'。\n` +
    `【先按需求判断要做哪一类，然后实现】：\n` +
    `  • 图表看板 → 用 echarts（见下方"图表规则"）。\n` +
    `  • 交互工具/计算器/模拟器 → 在 container 里建输入控件，读 data 实时计算并展示（可用 echarts 出图）。\n` +
    `  • 报表/打印视图 → 排一份适合打印的 DOM（标题/小计/表格）；放一个"🖨 打印/导出PDF"按钮，onclick=()=>window.print()。\n` +
    `  • 汇报幻灯片 → 在 container 里做翻页式幻灯（上一页/下一页按钮，支持左右方向键）。\n` +
    `  • 自定义视图 → 卡片墙 / 看板 / 时间线 / 甘特 等纯 DOM+SVG 视图。\n` +
    `【图表规则（做图表时遵守）】：默认只画一个最能回答需求的图；要多图(看板)时**绝不一个实例叠多坐标系**，` +
    `照骨架：container.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:10px;height:100%;overflow:auto';` +
    `function cell(){var d=document.createElement('div');d.style.minHeight='240px';container.appendChild(d);return echarts.init(d,theme);}` +
    `var c=cell();c.setOption({...})；类目轴标签多时 axisLabel:{interval:0,rotate:35~45} 防重叠、grid.bottom 留足；` +
    `数值都远大于0时数值轴 {scale:true} 避免从0留空白；图表类型只用 bar/line/pie/scatter；不在图里再放大标题（浮窗已有标题栏）。\n` +
    `【通用硬规则】：不要设 backgroundColor（透明）；只用真实存在的字段名、不编造数据；` +
    `**禁止 fetch / XMLHttpRequest / WebSocket / import / require / localStorage 等任何网络与 IO**；` +
    `只输出那个 JSON 对象本身，不要任何解释、前言或代码围栏。\n` +
    `\n【字段】${schemaText}\n\n【样本数据（前 ${sampleRows.length} 行）】\n${sanitizeForLlm(JSON.stringify(sampleRows))}\n\n【需求】${request}`
  )
}

/**
 * Edit prompt: hand the model the CURRENT code and one change request, and require a
 * minimal diff. This is what makes "调整" safe for multi-chart dashboards — regenerating
 * from scratch would restyle/reshuffle the charts the user didn't mention; editing the
 * existing code keeps them byte-identical.
 */
function buildEditPrompt(previousCode: string, request: string, schema: VizField[]): string {
  const schemaText = fieldList(schema)
  return (
    `下面是一个嵌在飞书页面浮窗里的"AI 小程序"的**当前完整代码**。请按【修改要求】对它做**最小改动**。\n` +
    `【最重要的规则】只改用户明确提到的那一处（某一个图表 / 某个控件 / 某段文案）；\n` +
    `其它图表、布局、配色、变量名**必须逐字保留、原样不动**——不要顺手重排、不要重命名、不要"优化"没被提到的部分。\n` +
    `运行时仍可用：data（完整数据数组）、echarts、container、theme、feishu（含义与原代码一致）。\n` +
    `若是多图看板：每个图各自 echarts.init 一个容器，改其中一个时绝不能动其它图的代码。\n` +
    `【字段】${schemaText}\n` +
    `【当前代码】\n${previousCode}\n` +
    `【修改要求】${request}\n` +
    `【输出】严格只输出一个 JSON 对象：{"title":"标题","code":"修改后的完整代码"}；保持原有取数方式与真实字段名；` +
    `**禁止 fetch / XMLHttpRequest / WebSocket / import / require / localStorage** 等任何网络与 IO；不要任何解释、前言或代码围栏。`
  )
}

export async function generateViz(
  settings: AppSettings,
  input: {
    schema: VizField[]; sampleRows: Record<string, string>[]; request: string
    previousCode?: string; previousSpec?: VizSpec
    signal?: AbortSignal; onProgress?: (chars: number) => void
  },
): Promise<{ name: string; code?: string; spec?: VizSpec; warning?: string }> {
  const content = NO_REMOTE_CODE
    ? (input.previousSpec ? buildSpecEditPrompt(input.previousSpec, input.request, input.schema) : buildSpecPrompt(input.schema, input.sampleRows, input.request))
    : (input.previousCode ? buildEditPrompt(input.previousCode, input.request, input.schema) : buildPrompt(input.schema, input.sampleRows, input.request))
  // Stream so the panel shows live progress ("已生成 N 字") + a working cancel — a 小程序 codegen
  // can take many seconds and a frozen spinner reads as "hung".
  const out = fences(await chatCompleteStream(settings, content, { signal: input.signal, onChunk: (f) => input.onProgress?.(f.length) }))
  if (!out) throw new Error('模型未返回内容。')
  if (NO_REMOTE_CODE) return parseSpec(out, input.schema)
  let parsed: { title?: string; name?: string; code?: string }
  try {
    parsed = JSON.parse(out)
  } catch {
    throw new Error('模型输出不是有效 JSON，无法解析可视化代码。请重试或换一个支持 JSON 输出的模型。')
  }
  const code = (parsed.code ?? '').trim()
  if (!code) throw new Error('模型没有生成可视化代码。')
  if (hasForbiddenCalls(code)) throw new Error('生成的代码包含被禁止的网络 / 导入调用，已拒绝。')
  return { name: (parsed.title || parsed.name || '可视化').slice(0, 40), code }
}

// ─── AI 建站：把表做成一个完整网站页面（复用沙箱/渲染/保存管线）─────────────

/** The injected design-system class menu the model must build with (kept in sync with
 *  sandbox/index.html `<style id="ds">`). Advertised verbatim in the site prompt. */
export function buildSiteCheatsheet(): string {
  return (
    `页面已注入一套设计系统 CSS（**只用这些 class 搭页面，不要自带配色/字体、不要写 <style> 标签、不要设 backgroundColor、不要任何外链**）：\n` +
    `布局：.site(页面外壳) · .nav(静态标题栏，仅 .brand/.dot) · .hero(h1/p) · .section(.section-title/.section-sub) · .grid(/.grid--2/3/4) · .row\n` +
    `组件：.card(.card-title/.card-body) · .stat(.num/.label/.delta--up/.delta--down) · .table-wrap>table.table · .btn(/.btn--primary) · .badge · .tag · .muted\n` +
    `**可靠交互助手 ui（数据区一律用它们，别手写任何交互/事件——手写极易失效）**：\n` +
    `  • ui.dashboard(容器, {data, filters:['字段'…], kpis:[{label,calc:rows=>值}…], charts:[{title,build:rows=>echarts配置}…], columns:[{key,label,editable?}], actions?:[{label,build:行=>任务标题}]})\n` +
    `    ——自带【筛选下拉条】，用户筛选时**自动联动重算** KPI 卡 / 图表 / 明细表；你只写纯函数 calc/build（行数组→值 / echarts 配置），交互由它负责，保证可用。这是数据区首选。\n` +
    `    · 写回 / 工作台（仅多维表格单表时自动生效，其它情况自动忽略、安全）：给某列 columns 项加 editable:true，该列就地可编辑（状态 / 标记类自动出下拉），用户改多行后由插件统一一键写回飞书；actions 为每行加按钮（如「建任务」，build 返回任务标题）。无需你写任何事件——勾上即可。\n` +
    `  • ui.chart(容器, echarts配置)——画一个 echarts 图（自动处理重绘/释放）。\n` +
    `  • ui.table(容器, data, {columns:[{key:'真实字段名',label}]})——带搜索/排序/分页、覆盖全部行的明细表。\n` +
    `单页骨架（从上到下、不分页不跳转）：<div class="site"><nav class="nav">…静态标题…</nav><div class="hero"><h1>…</h1></div><div class="section"><div id="dash"></div></div></div> 然后 ui.dashboard(container.querySelector('#dash'), {data, filters, kpis, charts, columns})`
  )
}

interface OtherTable { name: string; schema: VizField[]; sampleRows: Record<string, string>[] }

function buildSitePrompt(schema: VizField[], sampleRows: Record<string, string>[], request: string, refUrl?: string, planText?: string, otherTables?: OtherTable[]): string {
  const schemaText = fieldList(schema)
  const others = (otherTables ?? []).filter((t) => t.schema.length)
  const multiText = others.length
    ? `【本文档还有这些子表，可与主表联动——用 datasets['表名'] 取它们的全部行】\n` +
      others.map((t) => `  • ${t.name}：${t.schema.map((f) => f.name).join('、')}`).join('\n') + '\n' +
      `需要时按共同字段（如 ID / 名称）把它们与主表关联（建 Map 索引再 join），让页面体现跨表关系；只用真实字段名。\n`
    : ''
  return (
    `你是顶尖前端工程师 + 设计师。根据【字段】【样本数据】【需求】，生成一个**完整、好看、自包含**的网站页面，渲染在飞书页面的浮窗里。\n` +
    `输出一个 JSON 对象：{"title":"简短标题","code":"..."}。code 是构建页面的 JS（可直接写"函数体"，也可是完整 function render(data, echarts, container, theme, ui, datasets){...}），运行时可用：\n` +
    `  - data：主表的完整数据数组（每项一行对象，键=字段名，值是字符串，数字用 Number() 转）。\n` +
    `  - datasets：{表名: 行数组} —— 当前文档的**所有子表**（多维表格的多张数据表 / 电子表格的多个工作表）；data 即其中主表。跨表联动用它。\n` +
    `  - container：根容器（已撑满浮窗、可滚动，写 container.innerHTML 即可）。  - echarts：图表可用。  - theme：'light'/'dark'。  - **ui：可靠交互助手（见下，务必用它）**。\n` +
    buildSiteCheatsheet() + '\n' +
    TYPE_HINTS +
    multiText +
    `【做成一个【单页】、交互真能用的数据网站】：同一页面从上到下——静态标题栏 + 英雄区 + 数据区（指标 / 图表 / 明细）。\n` +
    `  **绝不要**多页面 / 标签页(tab)切换 / 点击跳转 / 路由 / "查看更多"跳转——这些极易失效；导航栏只作静态标题，**不要任何可点击切换内容的链接或按钮**。\n` +
    `  ① 数据区**优先用 ui.dashboard**：声明 filters / kpis(calc) / charts(build) / columns，它会渲染筛选条并在筛选时**联动重算** KPI、图表、明细表——这是页面交互的主体，丰富且保证可用。\n` +
    `  ② 需要独立图表用 ui.chart(容器, echarts配置)，独立明细表用 ui.table；**绝不要自己手写筛选 / 分页 / 排序 / tab 的事件逻辑**。\n` +
    `  ③ calc/build 必须是**纯函数**（行数组 → 值 / echarts 配置），不要在里面碰 DOM 或绑事件；④ 导航 / 英雄区 / 卡片是静态 DOM。\n` +
    `**数据绑定**：KPI / 图表 / 表格全部从 data / datasets 实时算或取，**绝不写死、不编造数据**；只用真实存在的字段名（见下【字段】）；columns.key、filters、calc/build 里引用的字段都必须真实存在。\n` +
    `**自检**：输出前确认——是【单页】、无 tab/跳转；数据区用了 ui.dashboard（或 ui.chart/ui.table）；字段名真实；筛选能联动 KPI/图表/明细表。\n` +
    (refUrl ? `【参考站点】${refUrl}：请参考这个站点的实际布局、信息层级、版式密度与视觉风格来组织页面（你了解或能预览它，就照它的版式来）；` +
      `但**只能用上面注入的设计系统 class 实现**，生成的页面本身不得包含任何外链（图片 / 字体 / 脚本 / CDN）。\n` : '') +
    (planText ? `【已和用户确认的方案，请据此实现】${planText}\n` : '') +
    `【硬规则】**禁止 fetch / XMLHttpRequest / WebSocket / EventSource / sendBeacon / import / require / localStorage / indexedDB 等任何网络与 IO；不要外链图片 / 字体 / CDN**；只输出那个 JSON 对象本身，不要任何解释、前言或代码围栏。\n` +
    `\n【字段】${schemaText}\n\n【样本数据（前 ${sampleRows.length} 行）】\n${sanitizeForLlm(JSON.stringify(sampleRows))}\n\n【需求】${request}`
  )
}

export async function generateSite(
  settings: AppSettings,
  input: {
    schema: VizField[]; sampleRows: Record<string, string>[]; request: string
    refUrl?: string; planText?: string; previousCode?: string; previousSpec?: VizSpec; otherTables?: OtherTable[]
    signal?: AbortSignal; onProgress?: (chars: number) => void
  },
): Promise<{ name: string; code?: string; spec?: VizSpec; warning?: string }> {
  // Language-adjust reuses the chart edit prompt (minimal-diff, keep-the-rest semantics are generic).
  const content = NO_REMOTE_CODE
    ? (input.previousSpec ? buildSpecEditPrompt(input.previousSpec, input.request, input.schema) : buildSiteSpecPrompt(input.schema, input.sampleRows, input.request, input.planText))
    : (input.previousCode ? buildEditPrompt(input.previousCode, input.request, input.schema) : buildSitePrompt(input.schema, input.sampleRows, input.request, input.refUrl, input.planText, input.otherTables))
  // Stream so the panel can show live progress + offer cancel (a full website is a big call).
  const out = fences(await chatCompleteStream(settings, content, { signal: input.signal, onChunk: (f) => input.onProgress?.(f.length) }))
  if (!out) throw new Error('模型未返回内容。')
  if (NO_REMOTE_CODE) return parseSpec(out, input.schema)
  let parsed: { title?: string; code?: string }
  try { parsed = JSON.parse(out) } catch { throw new Error('模型输出不是有效 JSON，无法解析网站代码。请重试或换一个支持 JSON 输出的模型。') }
  const code = (parsed.code ?? '').trim()
  if (!code) throw new Error('模型没有生成网站代码。')
  if (hasForbiddenCalls(code)) throw new Error('生成的代码包含被禁止的网络 / 导入调用，已拒绝。')
  return { name: (parsed.title || '网站').slice(0, 40), code }
}

export interface SitePlan { title: string; sections: string[]; fields: string[]; question?: string }

/** A cheap one-shot "build plan" so the user can confirm/adjust before full codegen. */
export async function planSite(
  settings: AppSettings,
  input: { schema: VizField[]; sampleRows: Record<string, string>[]; request: string; refUrl?: string },
): Promise<SitePlan> {
  const schemaText = fieldList(input.schema)
  const content =
    `根据【字段】【样本】【需求】，先给一个"建站方案"，**不要写代码**。\n` +
    `输出一个 JSON 对象：{"title":"页面标题","sections":["英雄区","指标概览","数据明细表"...],` +
    `"fields":["将用到的真实字段名"...],"question":"若有关键缺失 / 歧义就用一句话问用户，否则省略该字段"}。\n` +
    (input.refUrl ? `参考站点（请参考其布局 / 信息层级 / 风格）：${input.refUrl}\n` : '') +
    `只输出那个 JSON 对象本身，不要解释或代码围栏。\n【字段】${schemaText}\n【样本】\n${sanitizeForLlm(JSON.stringify(input.sampleRows))}\n【需求】${input.request}`
  const out = fences(await chatComplete(settings, content))
  let p: Partial<SitePlan>
  try { p = JSON.parse(out) } catch { throw new Error('方案解析失败，请重试或换一个支持 JSON 输出的模型。') }
  return {
    title: String(p.title ?? '数据网站').slice(0, 40),
    sections: Array.isArray(p.sections) ? p.sections.map(String).slice(0, 12) : [],
    fields: Array.isArray(p.fields) ? p.fields.map(String).slice(0, 30) : [],
    question: p.question ? String(p.question).slice(0, 200) : undefined,
  }
}
