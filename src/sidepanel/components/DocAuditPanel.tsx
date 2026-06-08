import { useEffect, useState } from 'react'
import type { AppSettings, PageContext } from '../../shared/types'
import { runDocAudit, loadAuditCheck, saveAuditCheck, DEFAULT_AUDIT_CHECK } from '../../shared/ai/docaudit'
import type { AuditResult } from '../../shared/ai/docaudit'
import './DocAuditPanel.css'

interface Props {
  settings: AppSettings
  context: PageContext
  disabled: boolean
  onBack: () => void
}

const SEV_LABEL: Record<string, string> = { high: '严重', medium: '一般', low: '提示' }
const SEV_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }

export default function DocAuditPanel({ settings, context, disabled, onBack }: Props) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const [result, setResult] = useState<AuditResult | null>(null)
  const [check, setCheck] = useState('')
  const [showCheck, setShowCheck] = useState(false)
  useEffect(() => { loadAuditCheck().then(setCheck) }, [])

  const documentId = context.feishu?.kind === 'doc' ? context.feishu.documentId : undefined
  const isWiki = context.feishu?.kind === 'wiki'

  async function run() {
    if (busy || !documentId) return
    setBusy(true); setErrMsg(''); setResult(null)
    try {
      setStatus('读取文档并体检中…（约需十几秒）')
      setResult(await runDocAudit(settings, documentId, check || undefined))
      setStatus('')
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e)); setStatus('')
    } finally { setBusy(false) }
  }

  const issues = result ? [...result.issues].sort((a, b) => (SEV_ORDER[a.severity] ?? 1) - (SEV_ORDER[b.severity] ?? 1)) : []

  return (
    <div className="scenario-panel view-enter" key="docaudit">
      <button className="sc-back" onClick={onBack}>← 返回</button>
      <div className="da-body">
        <div className="da-title">🩺 文档体检</div>
        <p className="da-sub">通读当前文档，AI 找出逻辑断点 / 未定义术语 / 前后矛盾 / 遗留 TODO / 过期数据 / 空小节等问题，给出可定位的清单。</p>

        {isWiki && <p className="da-hint da-hint--warn">正在解析知识库（Wiki）页面…若长时间无法识别，请直接打开文档本体再使用。</p>}
        {!documentId && !isWiki && <p className="da-hint da-hint--warn">请先打开一篇<b>飞书文档</b>页面再使用。</p>}

        {documentId && (
          <>
            <div className="da-fold" onClick={() => setShowCheck((s) => !s)}>
              {showCheck ? '▾' : '▸'} 检查项（点开可直接编辑，自定义体检什么）
            </div>
            {showCheck && (
              <>
                <textarea
                  className="da-check" rows={8} value={check}
                  onChange={(e) => setCheck(e.target.value)}
                  onBlur={() => saveAuditCheck(check)}
                  placeholder="每行一条检查维度…" disabled={busy}
                />
                <div className="da-check-actions">
                  <span className="da-mini" onClick={() => { setCheck(DEFAULT_AUDIT_CHECK); saveAuditCheck(DEFAULT_AUDIT_CHECK) }}>恢复默认</span>
                  <span className="da-mini-note">改完自动保存，页面右侧 ✨ 快捷体检也用这套</span>
                </div>
              </>
            )}
            <button className="da-btn da-btn--primary" onClick={run} disabled={disabled || busy}>
              {busy ? '体检中…' : result ? '重新体检' : '开始体检'}
            </button>
          </>
        )}

        {status && <p className="da-hint">{status}</p>}
        {errMsg && <p className="da-hint da-hint--err">{errMsg}</p>}
        {disabled && documentId && <p className="da-hint">体检需要 API Key——请先在「设置」里完成 API Key / 飞书授权。</p>}

        {result && (
          <>
            <div className="da-summary">
              {issues.length === 0
                ? '✅ 未发现明显问题'
                : <>发现 <b>{issues.length}</b> 处可改进点</>}
              {result.truncated && <>（文档较长，仅体检了前 {result.charsScanned} 字）</>}
            </div>
            <div className="da-list">
              {issues.map((it, i) => (
                <div className={`da-item da-sev--${it.severity}`} key={i}>
                  <div className="da-item-head">
                    <span className="da-badge">{SEV_LABEL[it.severity] ?? '一般'}</span>
                    <span className="da-type">{it.type}</span>
                  </div>
                  {it.quote && <div className="da-quote">「{it.quote}」</div>}
                  <div className="da-problem">{it.problem}</div>
                  {it.suggestion && <div className="da-suggestion">建议：{it.suggestion}</div>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
