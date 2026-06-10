import { useEffect, useRef, useState } from 'react'
import type { AppSettings, PageContext } from '../../shared/types'
import { generateSite, planSite, type SitePlan } from '../../shared/ai/dataviz'
import { fetchVizData, deriveVizSource, fetchDocDatasets, docOf } from '../../shared/dataviz/data'
import { NO_REMOTE_CODE } from '../../shared/config'
import { sendVizToActiveTab } from '../../shared/dataviz/send'
import { loadVizList, saveViz, deleteViz } from '../../shared/dataviz/store'
import { ctxScopeKey, vizMatchesCtx } from '../../shared/dataviz/scope'
import type { SavedViz, VizSource } from '../../shared/dataviz/types'
import type { VizSpec } from '../../shared/dataviz/spec'
import { buildDataReport } from '../../shared/report/build'
import type { ReportResult } from '../../shared/report/types'
import { resolveToken, isTokenExpiredError } from '../../shared/feishu/auth'
import { listMyChats, sendText, type ChatBrief } from '../../shared/feishu/im'
import './AISitePanel.css'

interface Props { settings: AppSettings; context: PageContext; disabled: boolean; onBack: () => void }

const SAMPLE_CAP = 30
const RENDER_CAP = 2000

function theme(): 'light' | 'dark' { return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light' }

/** fieldName → Feishu typeName, so the overlay can coerce edited cells to the right write-back type. */
const fieldTypesOf = (schema?: { name: string; type: string }[]): Record<string, string> | undefined =>
  schema?.length ? Object.fromEntries(schema.map((f) => [f.name, f.type])) : undefined

type LastGen = { name: string; code?: string; spec?: VizSpec; request?: string; source: VizSource; multi: boolean }
// The just-generated (maybe-unsaved) site, kept OUTSIDE React state keyed by the Base/Sheet doc.
// The side panel page stays loaded across browser-tab switches, but AISitePanel unmounts when the
// host view changes (e.g. visiting a non-Feishu tab) — local state would be lost and the user
// forced to regenerate. This module-level cache survives that, so returning restores the result.
const genCache = new Map<string, LastGen>()

/** Map an error to a user-facing string — expired sessions get a clear re-login hint. */
const errText = (e: unknown) => isTokenExpiredError(e)
  ? '飞书登录已失效，请在「设置」重新登录后再试' : e instanceof Error ? e.message : String(e)

/** Serialize a plan into editable text (the user can tweak it before generating). */
function planToText(p: SitePlan): string {
  const lines = [`标题：${p.title}`]
  if (p.sections.length) lines.push(`章节：${p.sections.join(' · ')}`)
  if (p.fields.length) lines.push(`用到字段：${p.fields.join('、')}`)
  lines.push('交互：筛选下拉联动重算指标卡 / 图表 / 明细表，表格自带搜索 / 排序 / 分页（覆盖全部数据）')
  return lines.join('\n')
}

export default function AISitePanel({ settings, context, disabled, onBack }: Props) {
  const [request, setRequest] = useState('')
  const [refUrl, setRefUrl] = useState('')
  const [planText, setPlanText] = useState('')
  const [planQuestion, setPlanQuestion] = useState('')
  const [status, setStatus] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [hasGen, setHasGen] = useState(false)
  const [canSave, setCanSave] = useState(false)
  const [list, setList] = useState<SavedViz[]>([])
  const last = useRef<LastGen | null>(null)
  // 输出闭环：导出飞书文档 + 推送到群。
  const [report, setReport] = useState<ReportResult | null>(null)
  const [chats, setChats] = useState<ChatBrief[]>([])
  const [chatId, setChatId] = useState('')
  const [pushed, setPushed] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [genChars, setGenChars] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  // A live elapsed ticker so the user can see it's still working (not frozen).
  useEffect(() => {
    if (!busy) { setElapsed(0); return }
    const t0 = Date.now()
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(id)
  }, [busy])

  const onlySites = (all: SavedViz[]) => all.filter((v) => v.kind === 'site')
  useEffect(() => { loadVizList().then((all) => setList(onlySites(all))) }, [])
  // Only show sites bound to the DATA-TABLE you're currently looking at (per-table, not the
  // whole Base file). ctxScopeKey gates "on a Base/Sheet at all" AND keys the restore-cache per
  // table (so switching tables in one Base won't restore/save another table's draft); vizMatchesCtx does the match.
  const curKey = ctxScopeKey(context.feishu)
  const visible = curKey ? list.filter((v) => vizMatchesCtx(v.source, context.feishu)) : []

  // Restore (or clear) the in-progress generated site for the doc now in view — survives the
  // unmount that a browser-tab switch triggers, so the user doesn't have to regenerate.
  useEffect(() => {
    const cached = curKey ? genCache.get(curKey) : null
    last.current = cached ?? null
    setHasGen(!!cached)
    setCanSave(!!cached)
    setStatus(cached ? `已恢复上次生成的「${cached.name}」——可保存或重新调整` : '')
  }, [curKey])

  useEffect(() => {
    if (typeof chrome === 'undefined') return
    const onMsg = (msg: { type?: string; ok?: boolean; message?: string }) => {
      if (msg?.type !== 'DATAVIZ_RESULT') return
      if (msg.ok) setStatus((s) => s || '渲染完成')
      else { setErrMsg('网站渲染失败：' + (msg.message || '生成的代码报错，可重试或换一种描述')); setStatus('') }
    }
    chrome.runtime.onMessage.addListener(onMsg)
    return () => chrome.runtime.onMessage.removeListener(onMsg)
  }, [])

  const onFeishuTable = context.feishu?.kind === 'base' || context.feishu?.kind === 'sheet'
  // A Wiki node wraps a base/sheet — App resolves it to base/sheet via an API call. Until then
  // (or if the token lacks wiki scope) show a "resolving" hint, not a scary "open a table".
  const isWiki = context.feishu?.kind === 'wiki'

  // Resolve the primary source + ALL sub-tables of the doc (so a site can link multiple sheets).
  async function sourceAndDatasets(cap: number) {
    if (!context.feishu) throw new Error('请在多维表格 / 电子表格页面使用')
    const source = await deriveVizSource(settings, context.feishu)
    if (!source) throw new Error('无法识别当前表，请打开一个多维表格或电子表格')
    const datasets = await fetchDocDatasets(settings, docOf(source), cap)
    if (!datasets.length || !datasets[0].schema.length) throw new Error('这张表没有可用的字段')
    return { source, datasets }
  }

  async function genPlan() {
    if (!request.trim() || busy) return
    setBusy(true); setErrMsg(''); setPlanText(''); setPlanQuestion('')
    try {
      setStatus('AI 规划页面…')
      const { datasets } = await sourceAndDatasets(SAMPLE_CAP)
      const p = await planSite(settings, { schema: datasets[0].schema, sampleRows: datasets[0].rows, request: request.trim(), refUrl: refUrl.trim() || undefined })
      setPlanText(planToText(p)); setPlanQuestion(p.question ?? '')
      setStatus('')
    } catch (e) { setErrMsg(errText(e)); setStatus('') } finally { setBusy(false) }
  }

  async function generate(refine = false) {
    if (busy || !request.trim() || (refine && !last.current)) return
    const ac = new AbortController(); abortRef.current = ac
    setBusy(true); setErrMsg(''); setCanSave(false); setGenChars(0); setReport(null); setPushed('')
    try {
      setStatus('读取全部数据…（约需几十秒）')
      // Fetch the full render data ONCE; slice a small prefix for the codegen prompt and reuse the
      // SAME datasets to render — avoids a second full pass over every sub-table after codegen.
      const { source, datasets: fullDs } = await sourceAndDatasets(RENDER_CAP)
      const primary = fullDs[0]
      const others = fullDs.slice(1).map((d) => ({ name: d.name, schema: d.schema, sampleRows: d.rows.slice(0, 6) }))
      setStatus(refine ? 'AI 调整网站中…（约需几十秒）' : 'AI 生成网站中…（约需几十秒，请耐心等待）')
      const { name, code, spec } = await generateSite(settings, {
        schema: primary.schema, sampleRows: primary.rows.slice(0, SAMPLE_CAP), request: request.trim(),
        refUrl: refUrl.trim() || undefined,
        planText: !refine ? (planText.trim() || undefined) : undefined,
        previousCode: refine ? last.current!.code : undefined,
        previousSpec: refine ? last.current!.spec : undefined,
        otherTables: others.length ? others : undefined,
        signal: ac.signal, onProgress: setGenChars,
      })
      const finalName = refine && last.current ? last.current.name : name
      const data = primary?.rows ?? []
      const datasets = Object.fromEntries(fullDs.map((d) => [d.name, d.rows]))
      const multi = fullDs.length > 1
      // Single-table Base → pass source so the overlay enables editable cells / write-back, plus the
      // column types so edited cells are coerced to the right JSON type (else the batch is rejected).
      const editSource = !multi && source.kind === 'base' ? source : undefined
      const fieldTypes = editSource ? fieldTypesOf(fullDs[0]?.schema) : undefined
      await sendVizToActiveTab({ code, spec, data, datasets, name: finalName, theme: theme(), source: editSource, fieldTypes })
      last.current = { name: finalName, code, spec, request: refine && last.current ? last.current.request : request.trim(), source, multi }
      if (curKey) genCache.set(curKey, last.current) // survive tab-switch unmount → no regenerate
      setHasGen(true); setCanSave(true); setPlanText(''); setPlanQuestion('')
      if (refine) setRequest('')
      setStatus(`已${refine ? '调整' : '生成'}「${finalName}」并展示在页面上`)
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') setStatus('已取消')
      else { setErrMsg(errText(e)); setStatus('') }
    } finally { setBusy(false); abortRef.current = null }
  }

  function cancel() { abortRef.current?.abort() }

  async function save() {
    if (!last.current) return
    const v: SavedViz = { id: crypto.randomUUID(), name: last.current.name, source: last.current.source, code: last.current.code, spec: last.current.spec, request: last.current.request, createdAt: Date.now(), kind: 'site', multi: last.current.multi }
    setList(onlySites(await saveViz(v))); setCanSave(false); setStatus(`已保存「${v.name}」到「我的网站」`)
  }

  function openUrl(url: string) { try { chrome.tabs?.create({ url }) } catch { window.open(url, '_blank') } }

  // 导出飞书文档：复用「数据分析报告」管线——读当前主表 → AI 写带真实数字的报告 → 建 Docx + 附源数据表。
  async function exportDoc() {
    if (!last.current || busy) return
    setBusy(true); setErrMsg(''); setReport(null); setPushed('')
    try {
      setStatus('AI 生成分析报告并写入飞书文档…（约需几十秒，请耐心等待）')
      const r = await buildDataReport(settings, last.current.source, request.trim(), context)
      setReport(r); setStatus(`已生成文档「${r.title}」`)
      // 顺带拉一次用户的群列表给「发到群」用（失败不致命）。
      try { setChats(await listMyChats(await resolveToken(settings))) } catch { /* 发到群时可重试 */ }
    } catch (e) { setErrMsg(errText(e)); setStatus('') } finally { setBusy(false) }
  }

  // 推送到群：把文档标题 + 链接作为一条文本消息发到所选群。
  async function pushToChat() {
    if (!report || !chatId || busy) return
    setBusy(true); setErrMsg(''); setPushed('')
    try {
      await sendText(await resolveToken(settings), chatId, `📊 ${report.title}\n${report.url}`)
      setPushed('已发送到所选群')
    } catch (e) { setErrMsg(errText(e)) } finally { setBusy(false) }
  }

  async function open(v: SavedViz) {
    setBusy(true); setErrMsg(''); setStatus(`打开「${v.name}」…`); setReport(null); setPushed('')
    try {
      // No-remote-code build can't run a legacy code-only site — rebuild it as a spec (one LLM
      // call) from its saved request, persist, then instant on future opens.
      if (NO_REMOTE_CODE && !v.spec && v.code) {
        setStatus(`「${v.name}」由旧版生成，正用当前数据重建…`)
        const vd = await fetchVizData(settings, v.source, RENDER_CAP)
        const { spec } = await generateSite(settings, { schema: vd.schema, sampleRows: vd.rows.slice(0, SAMPLE_CAP), request: v.request || v.name })
        // Match the normal-open guard: never enable write-back on a MULTI-sheet site (the spec
        // renders only the primary table, so an edit could target the wrong sub-table).
        const editSource = !v.multi && v.source.kind === 'base' ? v.source : undefined
        await sendVizToActiveTab({ spec, data: vd.rows, name: v.name, theme: theme(), source: editSource, fieldTypes: editSource ? fieldTypesOf(vd.schema) : undefined })
        // KEEP the original `code` — self-distribution builds still render it full-fidelity
        // (incl. multi-table); only store builds use the rebuilt spec. Never destroy the original.
        setList(onlySites(await saveViz({ ...v, spec })))
        setStatus(`已重建并渲染「${v.name}」（已保存，下次秒开）`)
        return
      }
      // Multi-sheet sites re-fetch ALL sub-tables; single-table sites just their one source.
      let data: unknown[]; let datasets: Record<string, unknown[]> | undefined
      let schema: { name: string; type: string }[] | undefined
      if (v.multi) {
        const ds = await fetchDocDatasets(settings, docOf(v.source), RENDER_CAP)
        data = ds[0]?.rows ?? []
        datasets = Object.fromEntries(ds.map((d) => [d.name, d.rows]))
      } else {
        const vd = await fetchVizData(settings, v.source, RENDER_CAP)
        data = vd.rows; schema = vd.schema
      }
      const editSource = !v.multi && v.source.kind === 'base' ? v.source : undefined
      const fieldTypes = editSource ? fieldTypesOf(schema) : undefined
      await sendVizToActiveTab({ code: v.code, spec: v.spec, data, datasets, name: v.name, theme: theme(), source: editSource, fieldTypes })
      setStatus(`已用最新数据渲染「${v.name}」`)
    } catch (e) { setErrMsg(errText(e)); setStatus('') } finally { setBusy(false) }
  }

  async function remove(v: SavedViz) { setList(onlySites(await deleteViz(v.id))) }

  return (
    <div className="scenario-panel view-enter" key="aisite">
      <button className="sc-back" onClick={onBack}>← 返回</button>
      <div className="as-body">
        <div className="as-title">🌐 AI 建站</div>
        <p className="as-sub">一句话把当前表做成一个完整的网站页面，渲染成页面浮窗；离线自包含、自动符合插件风格，可保存后用最新数据一键打开。</p>

        {isWiki && <p className="as-hint as-hint--warn">正在解析知识库（Wiki）页面…若长时间无法识别，请直接打开多维表格 / 电子表格本体再使用。</p>}
        {!onFeishuTable && !isWiki && <p className="as-hint as-hint--warn">请先打开一个<b>多维表格 / 电子表格</b>页面再使用。</p>}
        {NO_REMOTE_CODE && <p className="as-hint">📊 本版本生成<b>数据看板式网站</b>（指标 / 图表 / 可筛选联动 / 明细表）；不含自由式网页 / 计算器 / 自定义脚本视图（这些在自建分发版可用）。</p>}

        <textarea
          className="as-input" rows={3}
          placeholder={hasGen
            ? '继续用文字调整，例如：英雄区换深色；指标卡改成 4 列；加一个筛选区…'
            : '描述你想要的网站，例如：做一个销售业绩门户——英雄区 + 一块可按地区/品类筛选、联动指标卡和图表的数据看板，下面带搜索的明细表…'}
          value={request} onChange={(e) => setRequest(e.target.value)} disabled={disabled || !onFeishuTable}
        />
        {/* 参考站点 URL 仅在自分发(代码生成)版生效；商店(数据驱动)版忽略它，故隐藏。 */}
        {!NO_REMOTE_CODE && (
          <input
            className="as-url" placeholder="参考站点 URL（可选，让 AI 参考它的布局 / 风格；生成的页面仍离线自包含）"
            value={refUrl} onChange={(e) => setRefUrl(e.target.value)} disabled={disabled || !onFeishuTable}
          />
        )}

        {!hasGen ? (
          <div className="as-row">
            <button className="as-btn" onClick={genPlan} disabled={disabled || busy || !onFeishuTable || !request.trim()}>① 生成方案</button>
            <button className="as-btn as-btn--primary" onClick={() => generate(false)} disabled={disabled || busy || !onFeishuTable || !request.trim()}>直接生成</button>
          </div>
        ) : (
          <button className="as-btn as-btn--primary" onClick={() => generate(false)} disabled={disabled || busy || !request.trim()}>重新生成</button>
        )}

        {planText && (
          <div className="as-plan">
            <div className="as-plan-title">建站方案（可直接编辑后再生成）</div>
            {planQuestion && <div className="as-plan-q">❓ {planQuestion}</div>}
            <textarea className="as-plan-edit" rows={6} value={planText} onChange={(e) => setPlanText(e.target.value)} disabled={busy} />
            <button className="as-btn as-btn--primary" onClick={() => generate(false)} disabled={busy}>✅ 按方案生成网站</button>
          </div>
        )}

        {hasGen && (
          <button className="as-btn" onClick={() => generate(true)} disabled={disabled || busy || !request.trim()}>↺ 按上面文字微调（只改你说的那处）</button>
        )}
        {canSave && <button className="as-btn" onClick={save} disabled={busy}>⭐ 保存为「我的网站」</button>}

        {hasGen && (
          <div className="as-export">
            <div className="as-section">输出</div>
            <div className="as-row">
              <button className="as-btn" onClick={exportDoc} disabled={disabled || busy}>📄 导出飞书文档</button>
            </div>
            <p className="as-hint">🖨 打印 / 导出 PDF（含图表整页）在页面浮窗右上角。</p>
            {report && (
              <div className="as-report">
                <div className="as-report-title">✅ 文档「{report.title}」{report.tableAppended ? `（含前 ${report.rowsShown} 行数据）` : ''}</div>
                <button className="as-btn as-btn--primary" onClick={() => openUrl(report.url)}>打开文档 →</button>
                <div className="as-row">
                  <select className="as-url" value={chatId} onChange={(e) => setChatId(e.target.value)} disabled={busy || !chats.length}>
                    <option value="">{chats.length ? '选择要发送的群…' : '（无可用群 / 加载失败）'}</option>
                    {chats.map((c) => <option key={c.chatId} value={c.chatId}>{c.name}</option>)}
                  </select>
                  <button className="as-btn" onClick={pushToChat} disabled={busy || !chatId}>📤 发到群</button>
                </div>
                {pushed && <p className="as-hint">{pushed}</p>}
              </div>
            )}
          </div>
        )}

        {busy ? (
          <p className="as-hint">
            {/* 「已生成 N 字」与「取消」只在真正生成时有意义（abortRef 仅 generate 设置）——
                导出文档/发到群等其它 busy 操作不该显示上次生成留下的字数，取消也无对应中止器。 */}
            {status || '处理中…'}（已 {elapsed}s{abortRef.current && genChars > 0 ? `，已生成 ${genChars} 字` : ''}）
            {abortRef.current && <span className="as-cancel" onClick={cancel}>　取消</span>}
          </p>
        ) : status ? <p className="as-hint">{status}</p> : null}
        {errMsg && <p className="as-hint as-hint--err">{errMsg}</p>}
        {disabled && <p className="as-hint">请先在「设置」里完成 API Key / 飞书授权。</p>}

        {visible.length > 0 && (
          <>
            <div className="as-section">我的网站（当前表格 · 点击用最新数据打开）</div>
            <div className="as-list">
              {visible.map((v) => (
                <div key={v.id} className="as-item">
                  <button className="as-item-open" onClick={() => open(v)} disabled={busy} title="用最新数据重新渲染">🌐 {v.name}</button>
                  <button className="as-item-del" onClick={() => remove(v)} title="删除">✕</button>
                </div>
              ))}
            </div>
          </>
        )}
        {/* Saved sites are scoped to their source table; if none match here but the user saved some
            elsewhere, say so — otherwise it reads as「我做的网站丢了」. */}
        {visible.length === 0 && list.length > 0 && (
          <p className="as-hint">你在其它表格保存过 {list.length} 个网站——回到对应表格即可打开。</p>
        )}
      </div>
    </div>
  )
}
