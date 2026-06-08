import { useEffect, useState } from 'react'
import type { AppSettings, PageContext } from '../../shared/types'
import { runDocSummary, loadSummaryPrompt, saveSummaryPrompt, DEFAULT_SUMMARY_PROMPT } from '../../shared/ai/docsummary'
import type { SummaryResult } from '../../shared/ai/docsummary'
import './DocSummaryPanel.css'

interface Props {
  settings: AppSettings
  context: PageContext
  disabled: boolean
  onBack: () => void
}

export default function DocSummaryPanel({ settings, context, disabled, onBack }: Props) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const [result, setResult] = useState<SummaryResult | null>(null)
  const [prompt, setPrompt] = useState('')
  const [showPrompt, setShowPrompt] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => { loadSummaryPrompt().then(setPrompt) }, [])

  const documentId = context.feishu?.kind === 'doc' ? context.feishu.documentId : undefined
  const isWiki = context.feishu?.kind === 'wiki'

  async function run() {
    if (busy || !documentId) return
    setBusy(true); setErrMsg(''); setResult(null); setCopied(false)
    try {
      setStatus('读取文档并总结中…（约需十几秒）')
      setResult(await runDocSummary(settings, documentId, prompt || undefined))
      setStatus('')
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e)); setStatus('')
    } finally { setBusy(false) }
  }

  function copy() {
    if (!result) return
    try { navigator.clipboard?.writeText(result.summary); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* */ }
  }

  return (
    <div className="scenario-panel view-enter" key="docsummary">
      <button className="sc-back" onClick={onBack}>← 返回</button>
      <div className="ds-body">
        <div className="ds-title">📝 文档总结</div>
        <p className="ds-sub">通读当前文档，按你的要求生成总结（摘要 / 要点 / 待办…）。总结要求可自定义。</p>

        {isWiki && <p className="ds-hint ds-hint--warn">正在解析知识库（Wiki）页面…若长时间无法识别，请直接打开文档本体再使用。</p>}
        {!documentId && !isWiki && <p className="ds-hint ds-hint--warn">请先打开一篇<b>飞书文档</b>页面再使用。</p>}

        {documentId && (
          <>
            <div className="ds-fold" onClick={() => setShowPrompt((s) => !s)}>
              {showPrompt ? '▾' : '▸'} 总结要求（点开可直接编辑，自定义怎么总结）
            </div>
            {showPrompt && (
              <>
                <textarea
                  className="ds-prompt" rows={6} value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onBlur={() => saveSummaryPrompt(prompt)}
                  placeholder="例如：用一句话概括 + 3 条要点 + 风险提示…" disabled={busy}
                />
                <div className="ds-prompt-actions">
                  <span className="ds-mini" onClick={() => { setPrompt(DEFAULT_SUMMARY_PROMPT); saveSummaryPrompt(DEFAULT_SUMMARY_PROMPT) }}>恢复默认</span>
                  <span className="ds-mini-note">改完自动保存</span>
                </div>
              </>
            )}
            <button className="ds-btn ds-btn--primary" onClick={run} disabled={disabled || busy}>
              {busy ? '总结中…' : result ? '重新总结' : '生成总结'}
            </button>
          </>
        )}

        {status && <p className="ds-hint">{status}</p>}
        {errMsg && <p className="ds-hint ds-hint--err">{errMsg}</p>}
        {disabled && documentId && <p className="ds-hint">总结需要 API Key——请先在「设置」里完成 API Key / 飞书授权。</p>}

        {result && (
          <>
            <div className="ds-result-bar">
              <span>{result.truncated ? `已总结前 ${result.charsScanned} 字` : '总结完成'}</span>
              <button className="ds-mini-btn" onClick={copy}>{copied ? '已复制 ✓' : '复制'}</button>
            </div>
            <div className="ds-result">{result.summary}</div>
          </>
        )}
      </div>
    </div>
  )
}
