import { useState } from 'react'
import type { BaseCtx } from '../../shared/feishu/context'
import { ctxSummary } from '../../shared/feishu/context'
import { exportBaseAsTemplate, downloadTemplateJSON } from '../../shared/feishu/export'
import { resolveToken } from '../../shared/feishu/auth'
import type { AppSettings } from '../../shared/types'
import './BaseContextBadge.css'

interface Props {
  ctx: BaseCtx | null
  loading: boolean
  error: string
  settings: AppSettings
  onRefresh: () => void
}

type ExportState = 'idle' | 'loading' | 'done' | 'error'

export default function BaseContextBadge({ ctx, loading, error, settings, onRefresh }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [exportState, setExportState] = useState<ExportState>('idle')
  const [exportMsg, setExportMsg] = useState('')

  async function handleExport() {
    if (!ctx || exportState === 'loading') return
    setExportState('loading')
    setExportMsg('')
    try {
      const token = await resolveToken(settings)
      const template = await exportBaseAsTemplate(token, ctx.appToken)
      const filename = downloadTemplateJSON(template)
      setExportState('done')
      setExportMsg(filename)
      setTimeout(() => setExportState('idle'), 3000)
    } catch (err) {
      setExportState('error')
      setExportMsg(err instanceof Error ? err.message : String(err))
      setTimeout(() => setExportState('idle'), 4000)
    }
  }

  return (
    <div className="bcb">
      <div className="bcb-bar">
        {loading ? (
          <>
            <span className="bcb-spinner" />
            <span className="bcb-text bcb-text--muted">正在读取表结构…</span>
          </>
        ) : error && !ctx ? (
          <>
            <span className="bcb-dot bcb-dot--err" />
            <span className="bcb-text bcb-text--err" title={error}>
              {/授权|authoriz/i.test(error)
                ? '请先在「设置」用飞书账号授权后再读取'
                : /权限|forbidden|unauthorized|permission/i.test(error)
                ? '你的账号无该表权限'
                : `读取失败：${error.slice(0, 40)}${error.length > 40 ? '…' : ''}`}
            </span>
            <button className="bcb-action" onClick={onRefresh}>重试</button>
          </>
        ) : ctx ? (
          <>
            <span className="bcb-dot bcb-dot--ok" />
            <span className="bcb-app-name" title={ctx.appName}>{ctx.appName}</span>
            <span className="bcb-summary">{ctxSummary(ctx)}</span>
            <div className="bcb-spacer" />

            {/* Export button */}
            <button
              className={`bcb-export-btn ${exportState === 'done' ? 'bcb-export-btn--done' : ''} ${exportState === 'error' ? 'bcb-export-btn--err' : ''}`}
              onClick={handleExport}
              disabled={exportState === 'loading'}
              title="导出为模版 JSON（不含数据）"
            >
              {exportState === 'loading' && <span className="bcb-spinner bcb-spinner--sm" />}
              {exportState === 'idle' && (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              )}
              {exportState === 'done' && '✓'}
              {exportState === 'error' && '✕'}
              <span>
                {exportState === 'idle' && '导出模版'}
                {exportState === 'loading' && '导出中…'}
                {exportState === 'done' && exportMsg}
                {exportState === 'error' && '失败'}
              </span>
            </button>

            <button
              className="bcb-action"
              onClick={() => setExpanded(v => !v)}
              title={expanded ? '收起' : '查看字段详情'}
            >
              {expanded ? '收起 ▲' : '详情 ▼'}
            </button>
            <button className="bcb-action bcb-action--icon" onClick={onRefresh} title="重新读取">⟳</button>
          </>
        ) : null}
      </div>

      {/* Error toast */}
      {exportState === 'error' && exportMsg && (
        <div className="bcb-export-err">{exportMsg}</div>
      )}

      {expanded && ctx && (
        <div className="bcb-detail">
          {ctx.tables.map(t => (
            <div key={t.tableId} className={`bcb-tbl ${t.tableId === ctx.currentTableId ? 'bcb-tbl--current' : ''}`}>
              <div className="bcb-tbl-row">
                <span className="bcb-tbl-mark">▸</span>
                <span className="bcb-tbl-name">{t.tableName}</span>
                <span className="bcb-tbl-meta">{t.fields.length}字段 · {t.views.length}视图</span>
              </div>
              <div className="bcb-chips">
                {t.fields.map(f => (
                  <span
                    key={f.fieldId}
                    className="bcb-chip"
                    title={`[${f.typeName}]${f.options ? '\n' + f.options.join(' / ') : ''}`}
                  >
                    {f.fieldName}
                    {(f.type === 3 || f.type === 4) && <span className="bcb-chip-dot">●</span>}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
