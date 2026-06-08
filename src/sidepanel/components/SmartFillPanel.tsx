import { useEffect, useRef, useState } from 'react'
import type { AppSettings, PageContext } from '../../shared/types'
import { resolveFillSource, fetchFillableFields } from '../../shared/smartfill/data'
import { buildPlan, applyPlan } from '../../shared/smartfill/plan'
import { TYPE_LABEL } from '../../shared/smartfill/coerce'
import type { FillField, FillPlan, ApplyResult, FillSource } from '../../shared/smartfill/types'
import './SmartFillPanel.css'

interface Props {
  settings: AppSettings
  context: PageContext
  disabled: boolean
  onBack: () => void
}

export default function SmartFillPanel({ settings, context, disabled, onBack }: Props) {
  const [fields, setFields] = useState<FillField[]>([])
  const [target, setTarget] = useState('')
  const [instruction, setInstruction] = useState('')
  const [overwrite, setOverwrite] = useState(false)
  const [plan, setPlan] = useState<FillPlan | null>(null)
  const [applied, setApplied] = useState<ApplyResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const [loadErr, setLoadErr] = useState('')
  const [showSkip, setShowSkip] = useState(false)
  const source = useRef<FillSource | null>(null)

  const kind = context.feishu?.kind
  const onSupported = kind === 'base' || kind === 'sheet'
  const isWiki = kind === 'wiki'
  const srcKey = context.feishu?.appToken ?? context.feishu?.spreadsheetToken

  // Resolve the table/sheet + load its fillable fields (for the picker). Retryable, and runs
  // even when `disabled` (missing LLM key) — it only needs the Feishu token, so the user can
  // see their columns; LLM inference is gated separately at preview time. A failure here shows
  // a retry instead of bricking the panel.
  async function load() {
    const f = context.feishu
    if (!f || (f.kind !== 'base' && f.kind !== 'sheet')) return
    setLoading(true); setLoadErr('')
    try {
      const s = await resolveFillSource(settings, f)
      if (!s) throw new Error('识别到表格，但找不到可填充的数据，请刷新页面后重试。')
      source.current = s
      const fs = await fetchFillableFields(settings, s)
      setFields(fs)
      setTarget((t) => t || fs[0]?.name || '')
    } catch (e) {
      source.current = null
      setLoadErr(e instanceof Error ? e.message : String(e))
    } finally { setLoading(false) }
  }

  useEffect(() => {
    if (onSupported) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSupported, srcKey])

  function resetResult() { setPlan(null); setApplied(null); setShowSkip(false) }

  async function preview() {
    if (busy || loading) return
    // Lazily (re)resolve the table if the initial load failed — so a transient error
    // doesn't permanently dead-end the button.
    if (!source.current) { await load(); if (!source.current) return }
    if (!target) return
    setBusy(true); setErrMsg(''); resetResult()
    try {
      setStatus('读取数据并推断…')
      const p = await buildPlan(settings, source.current, {
        targetField: target, instruction: instruction.trim(), overwrite,
      })
      setPlan(p)
      if (!p.eligibleRows) setStatus(overwrite ? '表里没有数据行。' : '该列已全部填写（如需覆盖请勾选「覆盖已有值」）。')
      else if (!p.proposed.length) setStatus('没有可填的值——可调整说明或参考列后重试。')
      else setStatus('')
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e)); setStatus('')
    } finally { setBusy(false) }
  }

  async function apply() {
    if (!plan || !plan.proposed.length || busy) return
    setBusy(true); setErrMsg(''); setStatus('写入中…')
    try {
      const r = await applyPlan(settings, plan)
      setApplied(r); setPlan(null)
      if (r.failed) { setStatus(''); setErrMsg(`部分失败：${r.failed}（成功 ${r.done}，剩余 ${r.remaining} 未写入，可重试）`) }
      else setStatus('')
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e)); setStatus('')
    } finally { setBusy(false) }
  }

  return (
    <div className="scenario-panel view-enter" key="smartfill">
      <button className="sc-back" onClick={onBack}>← 返回</button>
      <div className="sf-body">
        <div className="sf-title">🪄 智能填充</div>
        <p className="sf-sub">选一列，AI 参考同行的其它列（和已填好的示例）推断该列空缺的值，预览确认后再写回。</p>

        {isWiki && <p className="sf-hint sf-hint--warn">正在解析知识库（Wiki）页面…若长时间无法识别，请直接打开多维表格 / 电子表格本体再使用。</p>}
        {!onSupported && !isWiki && <p className="sf-hint sf-hint--warn">请先打开一个<b>多维表格 / 电子表格</b>页面再使用。</p>}

        {onSupported && (
          <>
            {loadErr && (
              <p className="sf-hint sf-hint--err">{loadErr}　<span className="sf-retry" onClick={() => void load()}>重试</span></p>
            )}

            <div className="sf-label">要填充的列</div>
            <select
              className="sf-select" value={target}
              onChange={(e) => { setTarget(e.target.value); resetResult(); setStatus('') }}
              disabled={busy || loading || !fields.length}
            >
              {!fields.length && <option value="">{loading ? '（正在读取字段…）' : '（没有可填充的列）'}</option>}
              {fields.map((f) => <option key={f.id} value={f.name}>{f.name}（{TYPE_LABEL[f.type] ?? '字段'}）</option>)}
            </select>

            <div className="sf-label">填充说明（可选）</div>
            <textarea
              className="sf-input" rows={2}
              placeholder="例如：根据公司名和职位推断所属行业；按金额区间归类客户等级…"
              value={instruction} onChange={(e) => setInstruction(e.target.value)} disabled={busy}
            />

            <label className="sf-check">
              <input type="checkbox" checked={overwrite} onChange={(e) => { setOverwrite(e.target.checked); resetResult() }} disabled={busy} />
              覆盖已有值（默认只填空白单元格）
            </label>

            <button className="sf-btn sf-btn--primary" onClick={preview} disabled={disabled || busy || loading || !target}>
              {busy && !plan ? '处理中…' : '预览填充'}
            </button>
          </>
        )}

        {status && <p className="sf-hint">{status}</p>}
        {errMsg && <p className="sf-hint sf-hint--err">{errMsg}</p>}
        {disabled && onSupported && <p className="sf-hint">推断需要 API Key——请先在「设置」里完成 API Key / 飞书授权。</p>}

        {plan && plan.proposed.length > 0 && (
          <>
            <div className="sf-summary">
              将填充 <b>{plan.proposed.length}</b> 处「{plan.field.name}」
              {plan.skipped.length > 0 && <>，跳过 {plan.skipped.length} 处</>}
              {plan.morePending && <>（本轮预览 {plan.consideredRows}/{plan.eligibleRows} 行，应用后可再次预览余下）</>}
              {plan.capped && <>，表数据较大已截断</>}
            </div>
            <div className="sf-preview">
              {plan.proposed.map((p) => (
                <div className="sf-row" key={p.recordId}>
                  <span className="sf-row-label">{p.rowLabel}</span>
                  <span className="sf-row-arrow">→</span>
                  <span className="sf-row-val">{p.display}</span>
                </div>
              ))}
            </div>
            {plan.skipped.length > 0 && (
              <>
                <div className="sf-fold" onClick={() => setShowSkip((s) => !s)}>
                  {showSkip ? '▾' : '▸'} 跳过的 {plan.skipped.length} 行（不确定 / 不合规则）
                </div>
                {showSkip && (
                  <div className="sf-preview">
                    {plan.skipped.slice(0, 100).map((s, i) => (
                      <div className="sf-row sf-row--skip" key={i}>
                        <span className="sf-row-label">{s.rowLabel}</span>
                        <span className="sf-row-arrow">·</span>
                        <span className="sf-row-val">{s.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            <button className="sf-btn sf-btn--primary" onClick={apply} disabled={busy}>
              ✅ 应用 {plan.proposed.length} 处填充
            </button>
          </>
        )}

        {applied && (
          <div className="sf-summary">
            已成功填充 <b>{applied.done}</b> 处{applied.remaining > 0 && <>，{applied.remaining} 处未写入</>}。如还有空缺，可再次「预览填充」。
          </div>
        )}
      </div>
    </div>
  )
}
