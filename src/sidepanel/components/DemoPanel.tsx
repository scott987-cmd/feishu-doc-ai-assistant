import { useEffect, useRef, useState } from 'react'
import type { AppSettings } from '../../shared/types'
import { generateViz } from '../../shared/ai/dataviz'
import { generateSlidesFromData } from '../../shared/ai/slides'
import { SAMPLE_DATA, SAMPLE_TITLE } from '../../demo/sampleData'
import { NO_REMOTE_CODE } from '../../shared/config'
import { usingManagedLlm } from '../../shared/ai/llmConfig'

/**
 * Demo mode: try the AI dashboard / chart / slides features on BUNDLED sample data, with NO
 * Feishu login (just an LLM key). The sandbox is embedded right here in the side panel and
 * driven directly — no content script / Feishu page needed. Ideal for store reviewers (whose
 * Feishu OTP login + ~2h token can't be shared) and for first-time "try before setup".
 */
interface Props { settings: AppSettings; onBack: () => void }

type RenderPayload = { code?: string; spec?: unknown; data: unknown[] }

function theme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export default function DemoPanel({ settings, onBack }: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const ready = useRef(false)
  const pending = useRef<RenderPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const [request, setRequest] = useState('')

  const llmReady = usingManagedLlm(settings) || !!settings.openaiApiKey

  // The embedded sandbox tells us when it can receive a render (iframe-load race).
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return
      const d = e.data as { type?: string; message?: string }
      if (d?.type === 'DATAVIZ_READY') {
        ready.current = true
        if (pending.current) { post(pending.current); pending.current = null }
      } else if (d?.type === 'RENDER_ERR') {
        setErrMsg('渲染失败：' + (d.message || '请重试或换一种描述'))
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  function post(p: RenderPayload) {
    const win = iframeRef.current?.contentWindow
    if (!win) return
    const msg = { type: 'DATAVIZ_RENDER', nonce: 'demo', theme: theme(), data: p.data, code: p.code, spec: p.spec }
    if (ready.current) win.postMessage(msg, '*')
    else pending.current = p
  }

  async function run(kind: 'dashboard' | 'chart' | 'slides', req: string) {
    if (busy) return
    if (!llmReady) { setErrMsg('请先在「设置」里填入大模型 API Key（演示也需要它来生成内容）。'); return }
    setBusy(true); setErrMsg(''); setStatus('AI 生成中…（约几秒~几十秒）')
    try {
      if (kind === 'slides') {
        const { slides } = await generateSlidesFromData(settings, { schema: SAMPLE_DATA.schema, sampleRows: SAMPLE_DATA.rows.slice(0, 30), request: req })
        if (NO_REMOTE_CODE) post({ spec: { kind: 'slides', slides }, data: [] })
        else post({ code: 'ui.slides(container, data)', data: slides })
      } else {
        const { code, spec } = await generateViz(settings, { schema: SAMPLE_DATA.schema, sampleRows: SAMPLE_DATA.rows.slice(0, 30), request: req })
        post({ code, spec, data: SAMPLE_DATA.rows })
      }
      setStatus('已渲染到右侧/下方预览。可改下面的描述再生成。')
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e)); setStatus('')
    } finally { setBusy(false) }
  }

  return (
    <div className="demo-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border, #eee)' }}>
        <button className="sc-back" onClick={onBack}>← 返回</button>
        <div style={{ fontWeight: 600, marginTop: 4 }}>🎬 体验示例（无需飞书登录）</div>
        <div style={{ fontSize: 12, color: 'var(--muted, #888)', marginTop: 2 }}>
          用内置「{SAMPLE_TITLE}」数据演示 AI 看板 / 图表 / 幻灯片。只需在设置里填大模型 Key。
        </div>
        {!llmReady && <div style={{ fontSize: 12, color: '#d4380d', marginTop: 6 }}>⚠ 请先在「设置」填入大模型 API Key。</div>}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          <button className="as-btn as-btn--primary" disabled={busy || !llmReady} onClick={() => run('dashboard', '做一个销售业绩看板：按区域/产品可筛选，含销售额与订单数的 KPI、按月销售额折线、按区域销售额占比饼图，下面是明细表')}>📊 销售看板</button>
          <button className="as-btn" disabled={busy || !llmReady} onClick={() => run('chart', '按区域汇总销售额做一个柱状图')}>📈 图表</button>
          <button className="as-btn" disabled={busy || !llmReady} onClick={() => run('slides', '把这张销售表做成一套演示幻灯片')}>🎞️ 幻灯片</button>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input
            className="as-input" style={{ flex: 1 }} placeholder="或自己描述，例如：按产品看销售额排名"
            value={request} onChange={(e) => setRequest(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && request.trim()) void run('dashboard', request.trim()) }}
          />
          <button className="as-btn as-btn--primary" disabled={busy || !llmReady || !request.trim()} onClick={() => void run('dashboard', request.trim())}>生成</button>
        </div>
        {status && <div style={{ fontSize: 12, color: 'var(--muted, #888)', marginTop: 6 }}>{status}</div>}
        {errMsg && <div style={{ fontSize: 12, color: '#d4380d', marginTop: 6 }}>{errMsg}</div>}
      </div>
      <iframe
        ref={iframeRef}
        src={typeof chrome !== 'undefined' ? chrome.runtime.getURL('src/sandbox/index.html') : ''}
        onLoad={() => {
          // Fallback for the DATAVIZ_READY race: by load the sandbox's message listener is
          // registered, so mark ready and flush any queued render even if the READY msg was missed.
          ready.current = true
          if (pending.current) { post(pending.current); pending.current = null }
        }}
        style={{ flex: 1, width: '100%', border: 'none', background: '#fff' }}
        title="demo-preview"
      />
    </div>
  )
}
