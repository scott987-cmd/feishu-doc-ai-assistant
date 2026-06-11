import { useEffect, useRef, useState } from 'react'
import type { AppSettings, PageContext } from '../../shared/types'
import { runDocToSlides, runTableToSlides, adjustSlide, type Slide } from '../../shared/ai/slides'
import { loadDecks, saveDeck, deleteDeck, type SavedDeck } from '../../shared/ai/slidesStore'
import { sendVizToActiveTab } from '../../shared/dataviz/send'
import { fetchVizData } from '../../shared/dataviz/data'
import { deckScopeKey } from '../../shared/dataviz/scope'
import type { VizSource } from '../../shared/dataviz/types'
import { isTokenExpiredError } from '../../shared/feishu/auth'
import { NO_REMOTE_CODE } from '../../shared/config'
import './SlidesPanel.css'

interface Props {
  settings: AppSettings
  context: PageContext
  disabled: boolean
  onBack: () => void
}

const errText = (e: unknown) => isTokenExpiredError(e)
  ? '飞书登录已失效，请在「设置」重新登录后再试' : e instanceof Error ? e.message : String(e)

function theme(): 'light' | 'dark' { return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light' }

const EMBED_ROWS_CAP = 1000
type Deck = { name: string; slides: Slide[]; source?: VizSource; rows?: Record<string, string>[] }
// Generated deck kept OUTSIDE React state, keyed by srcKey — survives the unmount a browser-tab
// switch causes (the side panel page itself stays loaded), so returning doesn't force a regenerate.
const deckCache = new Map<string, Deck>()

/** Render a deck into the page overlay via the reliable sandbox `ui.slides` helper. Embed (看板)
 *  slides need the table rows, passed through `datasets` so the saved dashboard re-renders live. */
async function showDeck(deck: Deck): Promise<void> {
  const hasEmbed = deck.slides.some((s) => s.layout === 'embed')
  const rows = hasEmbed ? (deck.rows ?? []) : undefined
  if (NO_REMOTE_CODE) {
    // No-remote-code build: render the deck via a declarative slides spec (no eval bootstrap).
    await sendVizToActiveTab({ spec: { kind: 'slides', slides: deck.slides }, data: rows ?? [], name: deck.name, theme: theme() })
    return
  }
  await sendVizToActiveTab({
    code: rows ? "ui.slides(container, data, (datasets && datasets['默认']) || [])" : 'ui.slides(container, data)',
    data: deck.slides,
    datasets: rows ? { 默认: rows } : undefined,
    name: deck.name, // the overlay title bar already prefixes an icon
    theme: theme(),
  })
}

export default function SlidesPanel({ settings, context, disabled, onBack }: Props) {
  const [request, setRequest] = useState('')
  const [status, setStatus] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [hasGen, setHasGen] = useState(false)
  const [canSave, setCanSave] = useState(false)
  const [genChars, setGenChars] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [decks, setDecks] = useState<SavedDeck[]>([])
  const [adjPage, setAdjPage] = useState(1)
  const [adjReq, setAdjReq] = useState('')
  const last = useRef<Deck | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const slideCount = last.current?.slides.length ?? 0

  const kind = context.feishu?.kind
  const documentId = kind === 'doc' ? context.feishu?.documentId : undefined
  const isWiki = kind === 'wiki'
  // Cache/restore key: a doc by its id, a Base/Sheet by its doc key. Distinct namespaces, no clash.
  const srcKey = deckScopeKey(context.feishu) // = documentId (doc) ｜ ctxDocKey (base/sheet) — same key the launcher matches
  const canRun = !!srcKey
  const visible = srcKey ? decks.filter((d) => d.srcKey === srcKey) : []

  useEffect(() => { loadDecks().then(setDecks) }, [])

  // Live elapsed ticker so the user sees it's still working.
  useEffect(() => {
    if (!busy) { setElapsed(0); return }
    const t0 = Date.now()
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(id)
  }, [busy])

  // Restore (or clear) the deck for the content now in view — survives tab-switch unmount.
  useEffect(() => {
    const cached = srcKey ? deckCache.get(srcKey) : null
    last.current = cached ?? null
    setHasGen(!!cached); setCanSave(!!cached)
    setStatus(cached ? `已恢复上次生成的「${cached.name}」（${cached.slides.length} 页）——可重新展示 / 保存 / 重新生成` : '')
  }, [srcKey])

  async function generate() {
    if (busy || !srcKey || !context.feishu) return
    const ac = new AbortController(); abortRef.current = ac
    setBusy(true); setErrMsg(''); setStatus(''); setGenChars(0)
    try {
      setStatus(documentId ? '读取文档并生成幻灯片…（约需几十秒，请耐心等待）' : '读取表格并生成幻灯片…（约需几十秒，请耐心等待）')
      const r = documentId
        ? await runDocToSlides(settings, documentId, request.trim() || undefined, { signal: ac.signal, onProgress: setGenChars })
        : await runTableToSlides(settings, context.feishu, request.trim() || undefined, { signal: ac.signal, onProgress: setGenChars })
      const deck: Deck = { name: r.name, slides: r.slides, source: r.source, rows: r.rows }
      deckCache.set(srcKey, deck)
      last.current = deck
      setHasGen(true); setCanSave(true)
      await showDeck(deck)
      setStatus(`已生成「${r.name}」· 共 ${r.slides.length} 页${r.truncated ? '（内容较多，已截取前部分）' : ''}`)
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') setStatus('已取消')
      else { setErrMsg(errText(e)); setStatus('') }
    } finally { setBusy(false); abortRef.current = null }
  }

  function cancel() { abortRef.current?.abort() }

  // Clear the current draft so the user can build ANOTHER deck (saved ones stay in the list).
  function newDraft() {
    last.current = null
    if (srcKey) deckCache.delete(srcKey)
    setHasGen(false); setCanSave(false); setRequest(''); setStatus(''); setErrMsg(''); setGenChars(0); setAdjReq('')
  }

  async function reshow() {
    if (!last.current || busy) return
    setErrMsg('')
    try { await showDeck(last.current); setStatus(`已重新展示「${last.current.name}」`) }
    catch (e) { setErrMsg(errText(e)) }
  }

  async function save() {
    if (!last.current || !srcKey) return
    const d: SavedDeck = {
      id: crypto.randomUUID(), name: last.current.name, srcKey,
      slides: last.current.slides, source: last.current.source, createdAt: Date.now(),
    }
    setDecks(await saveDeck(d)); setCanSave(false); setStatus(`已保存「${d.name}」到「我的演示」`)
  }

  // Reopen a saved deck WITHOUT regenerating. Re-fetch live rows only when it has 看板 embed slides.
  async function openSaved(d: SavedDeck) {
    if (busy) return
    setBusy(true); setErrMsg(''); setStatus(`打开「${d.name}」…`)
    try {
      let rows: Record<string, string>[] | undefined
      if (d.source && d.slides.some((s) => s.layout === 'embed')) {
        rows = (await fetchVizData(settings, d.source, EMBED_ROWS_CAP)).rows
      }
      const deck: Deck = { name: d.name, slides: d.slides, source: d.source, rows }
      last.current = deck; setHasGen(true); setCanSave(false)
      if (srcKey) deckCache.set(srcKey, deck)
      await showDeck(deck)
      setStatus(`已展示「${d.name}」`)
    } catch (e) { setErrMsg(errText(e)); setStatus('') } finally { setBusy(false) }
  }

  async function remove(d: SavedDeck) { setDecks(await deleteDeck(d.id)) }

  // Adjust ONE page of the current deck via AI, then re-render in place (the rest is untouched).
  async function adjust() {
    const deck = last.current
    if (!deck || busy || !adjReq.trim()) return
    const idx = adjPage - 1
    if (idx < 0 || idx >= deck.slides.length) { setErrMsg(`页码需在 1–${deck.slides.length} 之间`); return }
    if (deck.slides[idx].layout === 'embed') { setErrMsg('这页是「看板」，请在「AI 小程序」里调整后再重新生成幻灯片'); return }
    setBusy(true); setErrMsg(''); setStatus(`调整第 ${adjPage} 页…`)
    try {
      const ns = await adjustSlide(settings, { slide: deck.slides[idx], instruction: adjReq.trim() })
      const slides = deck.slides.slice(); slides[idx] = ns
      const nd: Deck = { ...deck, slides }
      last.current = nd; if (srcKey) deckCache.set(srcKey, nd); setCanSave(true)
      await showDeck(nd)
      setStatus(`已调整第 ${adjPage} 页`); setAdjReq('')
    } catch (e) { setErrMsg(errText(e)); setStatus('') } finally { setBusy(false) }
  }

  return (
    <div className="scenario-panel view-enter" key="slides">
      <button className="sc-back" onClick={onBack}>← 返回</button>
      <div className="sl-body">
        <div className="sl-title">🎞️ AI 幻灯片</div>
        <p className="sl-sub">把当前飞书<b>文档</b>或<b>多维表格 / 电子表格</b>先总结/分析，再做成多页幻灯片 PPT（数据用图表呈现、可复用已保存的看板），渲染在页面浮窗里——翻页 / 自动播放 / ☀🌙 深浅色 / 🖨 导出 PDF；可保存，下次免生成直接打开。属于 AI 建站的一种输出。</p>

        {isWiki && <p className="sl-hint sl-hint--warn">正在解析知识库（Wiki）页面…若长时间无法识别，请直接打开文档 / 表格本体再使用。</p>}
        {!canRun && !isWiki && <p className="sl-hint sl-hint--warn">请先打开<b>飞书文档</b>或<b>多维表格 / 电子表格</b>页面再使用。</p>}

        {canRun && (
          <>
            <textarea
              className="sl-req" rows={2} value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder="额外要求（可选）：例如「侧重结论与风险」「控制在 10 页内」「面向管理层」…" disabled={busy}
            />
            <div className="sl-actions">
              <button className="sl-btn sl-btn--primary" onClick={generate} disabled={disabled || busy}>
                {busy ? '生成中…' : hasGen ? '重新生成' : '生成幻灯片'}
              </button>
              {hasGen && !busy && <button className="sl-btn" onClick={reshow}>重新展示</button>}
              {hasGen && !busy && canSave && <button className="sl-btn" onClick={save}>⭐ 保存</button>}
              {hasGen && !busy && <button className="sl-btn" onClick={newDraft}>＋ 新建一个</button>}
            </div>

            {hasGen && slideCount > 0 && (
              <div className="sl-adjust">
                <div className="sl-adjust-row">
                  <span className="sl-adjust-label">调整某页</span>
                  <input
                    className="sl-page" type="number" min={1} max={slideCount} value={adjPage} disabled={busy}
                    onChange={(e) => setAdjPage(Math.max(1, Math.min(slideCount, Number(e.target.value) || 1)))}
                  />
                  <span className="sl-adjust-of">/ {slideCount} 页</span>
                </div>
                <div className="sl-adjust-row">
                  <input
                    className="sl-adjust-req" type="text" value={adjReq} disabled={busy}
                    onChange={(e) => setAdjReq(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') adjust() }}
                    placeholder="例如：改成饼图 / 精简为 3 条 / 换个标题 / 加一句结论"
                  />
                  <button className="sl-btn" onClick={adjust} disabled={busy || !adjReq.trim()}>调整这页</button>
                </div>
              </div>
            )}
          </>
        )}

        {busy ? (
          <p className="sl-hint">
            {status || '处理中…'}（已 {elapsed}s{genChars > 0 ? `，已生成 ${genChars} 字` : ''}）
            <span className="sl-cancel" onClick={cancel}>　取消</span>
          </p>
        ) : status ? <p className="sl-hint">{status}</p> : null}
        {errMsg && <p className="sl-hint sl-hint--err">{errMsg}</p>}
        {disabled && canRun && <p className="sl-hint">生成需要 API Key——请先在「设置」里完成 API Key / 飞书授权。</p>}

        {visible.length > 0 && (
          <>
            <div className="sl-section">我的演示（当前页面 · 点击免生成直接打开）</div>
            <div className="sl-list">
              {visible.map((d) => (
                <div key={d.id} className="sl-item">
                  <button className="sl-item-open" onClick={() => openSaved(d)} disabled={busy} title="直接展示这套已保存的幻灯片">🎞️ {d.name}</button>
                  <button className="sl-item-del" onClick={() => remove(d)} title="删除">✕</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
