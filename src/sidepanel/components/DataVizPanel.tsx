import { useEffect, useRef, useState } from 'react'
import type { AppSettings, PageContext } from '../../shared/types'
import { generateViz } from '../../shared/ai/dataviz'
import { fetchVizData, deriveVizSource } from '../../shared/dataviz/data'
import { sendVizToActiveTab } from '../../shared/dataviz/send'
import { loadVizList, saveViz, deleteViz } from '../../shared/dataviz/store'
import { ctxScopeKey, savedVizMatchesCtx } from '../../shared/dataviz/scope'
import { NO_REMOTE_CODE } from '../../shared/config'
import { isTokenExpiredError } from '../../shared/feishu/auth'
import type { SavedViz, VizSource } from '../../shared/dataviz/types'
import type { VizSpec } from '../../shared/dataviz/spec'
import './DataVizPanel.css'

/** Map an error to a user-facing string — expired sessions get a clear re-login hint. */
const errText = (e: unknown) => isTokenExpiredError(e)
  ? '飞书登录已失效，请在「设置」重新登录后再试' : e instanceof Error ? e.message : String(e)

interface Props {
  settings: AppSettings
  context: PageContext
  disabled: boolean
  onBack: () => void
}

const SAMPLE_CAP = 30
const RENDER_CAP = 2000

function theme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

async function sendToOverlay(artifact: { code?: string; spec?: VizSpec }, data: unknown[], name: string) {
  await sendVizToActiveTab({ ...artifact, data, name, theme: theme() })
}

type LastViz = { name: string; code?: string; spec?: VizSpec; request?: string; source: VizSource }
// The just-generated (maybe-unsaved) 小程序, kept OUTSIDE React state keyed by the doc — survives
// the AISitePanel/DataVizPanel unmount a browser-tab switch causes, so returning doesn't force a
// regenerate (the side panel page itself stays loaded across tab switches).
const genCache = new Map<string, LastViz>()

export default function DataVizPanel({ settings, context, disabled, onBack }: Props) {
  const [request, setRequest] = useState('')
  const [status, setStatus] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [genChars, setGenChars] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const [list, setList] = useState<SavedViz[]>([])
  // The just-generated viz, available to save / iterate on. Its `code` is the base a
  // "调整" edits in place (keeps charts the user didn't mention byte-identical).
  const last = useRef<LastViz | null>(null)
  const [canSave, setCanSave] = useState(false)
  const [hasGen, setHasGen] = useState(false)

  // This panel manages 小程序 (everything that isn't a full 网站); 网站 live in the AISite panel.
  const onlyVizzes = (all: SavedViz[]) => all.filter((v) => v.kind !== 'site')
  useEffect(() => { loadVizList().then((all) => setList(onlyVizzes(all))) }, [])

  // Render result from the sandbox (relayed by the content script).
  useEffect(() => {
    if (typeof chrome === 'undefined') return
    const onMsg = (msg: { type?: string; ok?: boolean; message?: string }) => {
      if (msg?.type !== 'DATAVIZ_RESULT') return
      if (msg.ok) setStatus((s) => s || '渲染完成')
      else { setErrMsg('图表渲染失败：' + (msg.message || '生成的代码报错，可重试或换一种描述')); setStatus('') }
    }
    chrome.runtime.onMessage.addListener(onMsg)
    return () => chrome.runtime.onMessage.removeListener(onMsg)
  }, [])

  const onFeishuTable = context.feishu?.kind === 'base' || context.feishu?.kind === 'sheet'
  // Wiki wraps a base/sheet — resolved by App via an API call; show a resolving hint until then.
  const isWiki = context.feishu?.kind === 'wiki'
  // Only show 小程序 bound to the data-table you're currently looking at (per-table scope).
  // Key the restore-cache per TABLE (ctxScopeKey), so switching tables in one Base doesn't
  // restore/save another table's draft (visible already filters per-table via vizMatchesCtx).
  const curKey = ctxScopeKey(context.feishu)
  const visible = curKey ? list.filter((v) => savedVizMatchesCtx(v, context.feishu)) : []

  // Restore (or clear) the in-progress generated 小程序 for the doc now in view — survives the
  // unmount a browser-tab switch triggers, so the user doesn't have to regenerate.
  useEffect(() => {
    const cached = curKey ? genCache.get(curKey) : null
    last.current = cached ?? null
    setHasGen(!!cached)
    setCanSave(!!cached)
    setStatus(cached ? `已恢复上次生成的「${cached.name}」——可保存或重新调整` : '')
  }, [curKey])

  async function generate(refine = false) {
    if (!request.trim() || busy) return
    if (refine && !last.current) return
    setBusy(true); setErrMsg(''); setCanSave(false); setGenChars(0)
    const ac = new AbortController(); abortRef.current = ac
    try {
      if (!context.feishu) throw new Error('请在多维表格 / 电子表格页面使用')
      setStatus('读取表结构…')
      const source = await deriveVizSource(settings, context.feishu)
      if (!source) throw new Error('无法识别当前表，请打开一个多维表格或电子表格')
      const sample = await fetchVizData(settings, source, SAMPLE_CAP)
      if (!sample.schema.length) throw new Error('这张表没有可用的字段')

      setStatus(refine ? 'AI 调整当前小程序…' : 'AI 生成小程序代码…')
      // Refine = EDIT the previous code in place (only change what's asked, keep the rest
      // identical). Far better for multi-chart dashboards than regenerating from scratch.
      const { name, code, spec, warning } = await generateViz(settings, {
        schema: sample.schema, sampleRows: sample.rows, request: request.trim(),
        previousCode: refine ? last.current!.code : undefined,
        previousSpec: refine ? last.current!.spec : undefined,
        signal: ac.signal, onProgress: setGenChars,
      })
      // On a tweak, keep the dashboard's existing name (the edit shouldn't rename it).
      const finalName = refine && last.current ? last.current.name : name

      setStatus('拉取全部数据并渲染…')
      const full = await fetchVizData(settings, source, RENDER_CAP)
      await sendToOverlay({ code, spec }, full.rows, finalName)

      last.current = { name: finalName, code, spec, request: refine && last.current ? last.current.request : request.trim(), source }
      if (curKey) genCache.set(curKey, last.current) // survive tab-switch unmount → no regenerate
      setHasGen(true); setCanSave(true)
      if (refine) setRequest('') // each tweak is independent now — clear for the next one
      // Append the unmatched-field warning to the (neutral) success status — NOT the red error
      // slot — and it clears itself on the next action.
      setStatus(`已${refine ? '调整' : '生成'}「${finalName}」并展示在页面上${warning ? `　⚠ ${warning}` : ''}`)
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') setStatus('已取消')
      else { setErrMsg(errText(e)); setStatus('') }
    } finally {
      setBusy(false); abortRef.current = null
    }
  }

  function cancel() { abortRef.current?.abort() }

  async function save() {
    if (!last.current) return
    const v: SavedViz = {
      id: crypto.randomUUID(), name: last.current.name, source: last.current.source,
      code: last.current.code, spec: last.current.spec, request: last.current.request,
      createdAt: Date.now(), kind: 'viz',
    }
    setList(onlyVizzes(await saveViz(v))); setCanSave(false); setStatus(`已保存「${v.name}」到「我的小程序」`)
  }

  // Re-open a saved viz: re-fetch LIVE data and render with the SAVED code/spec — zero LLM.
  async function open(v: SavedViz) {
    setBusy(true); setErrMsg(''); setStatus(`打开「${v.name}」…`)
    try {
      // No-remote-code build can't run a legacy code-only board — rebuild it as a spec (one LLM
      // call) from its saved request, persist the spec, then it's instant on future opens.
      if (NO_REMOTE_CODE && !v.spec && v.code) {
        setStatus(`「${v.name}」由旧版生成，正用当前数据重建…`)
        // Single fetch (RENDER_CAP ⊇ SAMPLE_CAP) — slice a prefix for codegen, render the rest.
        const full = await fetchVizData(settings, v.source, RENDER_CAP)
        const { spec, warning } = await generateViz(settings, { schema: full.schema, sampleRows: full.rows.slice(0, SAMPLE_CAP), request: v.request || v.name })
        await sendToOverlay({ spec }, full.rows, v.name)
        // KEEP original `code` (self-dist still renders it; only store builds use the spec).
        setList(onlyVizzes(await saveViz({ ...v, spec })))
        setStatus(`已重建并渲染「${v.name}」（已保存，下次秒开）${warning ? `　⚠ ${warning}` : ''}`)
        return
      }
      const full = await fetchVizData(settings, v.source, RENDER_CAP)
      await sendToOverlay({ code: v.code, spec: v.spec }, full.rows, v.name)
      setStatus(`已用最新数据渲染「${v.name}」`)
    } catch (e) {
      setErrMsg(errText(e)); setStatus('')
    } finally { setBusy(false) }
  }

  async function remove(v: SavedViz) { setList(onlyVizzes(await deleteViz(v.id))) }

  return (
    <div className="scenario-panel view-enter" key="dataviz">
      <button className="sc-back" onClick={onBack}>← 返回</button>
      <div className="dv-body">
        <div className="dv-title">🧩 AI 小程序</div>
        <p className="dv-sub">用一句话把当前表做成图表 / 报表 / 看板 / 计算器 / 幻灯片，渲染成页面上的浮窗。</p>

        {isWiki && (
          <p className="dv-hint dv-hint--warn">正在解析知识库（Wiki）页面…若长时间无法识别，请直接打开多维表格 / 电子表格本体再使用。</p>
        )}
        {!onFeishuTable && !isWiki && (
          <p className="dv-hint dv-hint--warn">请先打开一个<b>多维表格 / 电子表格</b>页面再使用。</p>
        )}

        <textarea
          className="dv-input"
          placeholder={hasGen
            ? '只调你说的那一处，例如：把第二个图换成饼图；放大标题；左边的图加数据标签…（其它图保持不动）'
            : '例如：按地区销量做柱状图；做一个利润计算器；把这张表做成可打印报表；做一页汇报幻灯片…'}
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          rows={3}
          disabled={disabled || !onFeishuTable}
        />
        <button className="dv-btn dv-btn--primary" onClick={() => generate(false)} disabled={disabled || busy || !onFeishuTable || !request.trim()}>
          {busy ? '处理中…' : hasGen ? '重新生成' : '生成并展示'}
        </button>
        {hasGen && (
          <button className="dv-btn" onClick={() => generate(true)} disabled={disabled || busy || !request.trim()}>
            ↺ 按上面文字微调（只改你说的那处）
          </button>
        )}
        {canSave && (
          <button className="dv-btn" onClick={save} disabled={busy}>⭐ 保存为「我的小程序」</button>
        )}
        {status && <p className="dv-hint">{status}</p>}
        {busy && (
          <p className="dv-hint">
            {genChars > 0 ? `AI 生成中…已生成 ${genChars} 字` : 'AI 处理中…'}
            {abortRef.current && <span className="dv-cancel" onClick={cancel} style={{ marginLeft: 8, color: '#4f6bff', cursor: 'pointer' }}>取消</span>}
          </p>
        )}
        {errMsg && <p className="dv-hint dv-hint--err">{errMsg}</p>}
        {disabled && <p className="dv-hint">请先在「设置」里完成 API Key / 飞书授权。</p>}

        {visible.length > 0 && (
          <>
            <div className="dv-section">我的小程序（当前表格 · 点击用最新数据打开）</div>
            <div className="dv-list">
              {visible.map((v) => (
                <div key={v.id} className="dv-item">
                  <button className="dv-item-open" onClick={() => open(v)} disabled={busy} title="用最新数据重新渲染">
                    📊 {v.name}
                  </button>
                  <button className="dv-item-del" onClick={() => remove(v)} title="删除">✕</button>
                </div>
              ))}
            </div>
          </>
        )}
        {/* Saved items are scoped to their source table; if none match here but the user has saved
            some elsewhere, say so — otherwise it reads as「我做的东西丢了」. */}
        {visible.length === 0 && list.length > 0 && (
          <p className="dv-hint">你在其它表格保存过 {list.length} 个小程序——回到对应表格即可打开。</p>
        )}
      </div>
    </div>
  )
}
