import { useState } from 'react'
import type { AppSettings, PageContext } from '../../shared/types'
import { deriveVizSource } from '../../shared/dataviz/data'
import { buildDataReport } from '../../shared/report/build'
import type { ReportResult } from '../../shared/report/types'
import './DataReportPanel.css'

interface Props {
  settings: AppSettings
  context: PageContext
  disabled: boolean
  onBack: () => void
}

export default function DataReportPanel({ settings, context, disabled, onBack }: Props) {
  const [focus, setFocus] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const [result, setResult] = useState<ReportResult | null>(null)

  const kind = context.feishu?.kind
  const onSupported = kind === 'base' || kind === 'sheet'
  const isWiki = kind === 'wiki'

  async function generate() {
    if (busy || !context.feishu) return
    setBusy(true); setErrMsg(''); setResult(null)
    try {
      setStatus('读取数据…')
      const source = await deriveVizSource(settings, context.feishu)
      if (!source) throw new Error('无法识别当前表，请打开一个多维表格或电子表格')
      setStatus('AI 分析并生成报告文档…（约需几十秒，请耐心等待）')
      setResult(await buildDataReport(settings, source, focus, context))
      setStatus('')
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e)); setStatus('')
    } finally { setBusy(false) }
  }

  function open(url: string) { try { chrome.tabs?.create({ url }) } catch { window.open(url, '_blank') } }

  return (
    <div className="scenario-panel view-enter" key="report">
      <button className="sc-back" onClick={onBack}>← 返回</button>
      <div className="rp-body">
        <div className="rp-title">📈 数据分析报告</div>
        <p className="rp-sub">读取当前表的数据，AI 写一篇带真实数字的分析报告（摘要 / 关键发现 / 趋势 / 建议），生成飞书文档并在文末附上源数据表。</p>

        {isWiki && <p className="rp-hint rp-hint--warn">正在解析知识库（Wiki）页面…若长时间无法识别，请直接打开多维表格 / 电子表格本体再使用。</p>}
        {!onSupported && !isWiki && <p className="rp-hint rp-hint--warn">请先打开一个<b>多维表格 / 电子表格</b>页面再使用。</p>}

        {onSupported && (
          <>
            <div className="rp-label">分析重点（可选）</div>
            <textarea
              className="rp-input" rows={2}
              placeholder="例如：重点看销售趋势；分析各区域差异；找出异常客户…"
              value={focus} onChange={(e) => setFocus(e.target.value)} disabled={busy}
            />
            <button className="rp-btn rp-btn--primary" onClick={generate} disabled={disabled || busy}>
              {busy ? '生成中…' : '生成分析报告'}
            </button>
          </>
        )}

        {status && <p className="rp-hint">{status}</p>}
        {errMsg && <p className="rp-hint rp-hint--err">{errMsg}</p>}
        {disabled && onSupported && <p className="rp-hint">生成需要 API Key——请先在「设置」里完成 API Key / 飞书授权。</p>}

        {result && (
          <div className="rp-result">
            <div className="rp-result-title">✅ 已生成「{result.title}」</div>
            <div className="rp-result-meta">
              {result.tableAppended ? `已附源数据前 ${result.rowsShown} 行` : '（数据表追加失败，正文已生成）'}，共 {result.rowCount} 行
            </div>
            <button className="rp-btn rp-btn--primary" onClick={() => open(result.url)}>打开文档 →</button>
          </div>
        )}
      </div>
    </div>
  )
}
