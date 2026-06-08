import React, { useEffect, useState } from 'react'
import type { AppSettings, PageContext } from '../../shared/types'
import type { ScenarioTemplate, ProgressStep, CreationResult } from '../../shared/templates/types'
import { BUILTIN_TEMPLATES } from '../../shared/templates/builtin'
import { executeTemplate } from '../../shared/templates/engine'
import { fetchRemoteTemplates, mergeTemplates, getCacheInfo, clearRegistryCache } from '../../shared/templates/registry'
import { resolveToken } from '../../shared/feishu/auth'
import { safeImageSrc, openUrlInNewTab } from '../../shared/url'
import { CLIP_ENABLED } from '../../shared/config'
import { TemplateCardSkeleton } from './Skeleton'
import DataVizPanel from './DataVizPanel'
import AISitePanel from './AISitePanel'
import SmartFillPanel from './SmartFillPanel'
import DataReportPanel from './DataReportPanel'
import DocAuditPanel from './DocAuditPanel'
import DocSummaryPanel from './DocSummaryPanel'
import SlidesPanel from './SlidesPanel'
import './ScenarioPanel.css'

// Baked in at build time via VITE_DEFAULT_REGISTRY_URL env var.
// Falls back to empty string (builtin-only) if not set.
const DEFAULT_REGISTRY: string = import.meta.env.VITE_DEFAULT_REGISTRY_URL ?? ''

interface Props {
  settings: AppSettings
  context: PageContext
  disabled: boolean
  /** Signals an in-flight template build so the host can freeze nav that would unmount us
   *  mid-build (switching tab destroys this panel's local progress/result state). */
  onBusyChange?: (busy: boolean) => void
}

type View =
  | { mode: 'hub' }
  | { mode: 'dataviz' }
  | { mode: 'aisite' }
  | { mode: 'smartfill' }
  | { mode: 'report' }
  | { mode: 'docaudit' }
  | { mode: 'docsummary' }
  | { mode: 'slides' }
  | { mode: 'gallery' }
  | { mode: 'detail'; template: ScenarioTemplate }
  | { mode: 'progress'; template: ScenarioTemplate; steps: ProgressStep[]; error?: string; inputs?: Record<string, string> }
  | { mode: 'done'; result: CreationResult }

const CATEGORIES = ['全部', '电商', '项目管理', 'CRM']

export default function ScenarioPanel({ settings, context, disabled, onBusyChange }: Props) {
  const [view, setView] = useState<View>({ mode: 'hub' })
  const [templates, setTemplates] = useState<ScenarioTemplate[]>(BUILTIN_TEMPLATES)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('全部')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const [cacheInfo, setCacheInfo] = useState(getCacheInfo())

  // Auto-fetch when settings arrive or registry URL changes.
  // Effective URL = user override → build-time default → builtin only.
  useEffect(() => {
    const effectiveUrl = settings.templateRegistryUrl || DEFAULT_REGISTRY
    if (effectiveUrl) loadRemote(effectiveUrl, false)
    else setTemplates(BUILTIN_TEMPLATES)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.templateRegistryUrl])

  async function loadRemote(url: string, force: boolean) {
    if (force) clearRegistryCache()
    setRefreshing(true)
    setRefreshError('')
    const { templates: remote, error } = await fetchRemoteTemplates(url)
    if (error) setRefreshError(error)
    setTemplates(mergeTemplates(remote))
    setCacheInfo(getCacheInfo())
    setRefreshing(false)
  }

  // Launch (or re-launch) a template build, wiring progress + a recoverable failure
  // state. Shared by the detail "开始创建" action and the failure "重试" button so the
  // flow always lands on a screen with a way out — never a dead progress screen.
  function launchTemplate(tpl: ScenarioTemplate, inputs: Record<string, string>) {
    onBusyChange?.(true) // freeze host nav while building (runTemplate always settles → always cleared)
    setView({ mode: 'progress', template: tpl, steps: [], inputs })
    runTemplate(tpl, inputs, settings, context, (steps) => {
      setView(v => (v.mode === 'progress' ? { ...v, steps } : v))
    })
      .then(result => setView({ mode: 'done', result }))
      .catch(err => {
        const msg = err instanceof Error ? err.message : String(err)
        setView(v => (v.mode === 'progress' ? { ...v, error: msg } : v))
      })
      .finally(() => onBusyChange?.(false))
  }

  // ── Gallery ──────────────────────────────────────────────────────────────

  const filtered = templates.filter(t => {
    const q = search.toLowerCase()
    const matchSearch = !q || t.name.toLowerCase().includes(q) || t.tags.some(tag => tag.toLowerCase().includes(q))
    const matchCat = category === '全部' || t.category === category
    return matchSearch && matchCat
  })

  // ── Hub (feature launcher — the 场景 tab landing) ──────────────────────────

  if (view.mode === 'hub') {
    // Context-aware hub: the header already knows the page's resource type (App.tsx badge), so
    // surface the features that fit THIS page first and DIM the ones that need another resource
    // (with a 「需…」 tag) instead of letting the user discover the mismatch only after a full-panel
    // navigation + 返回. Unknown / wiki(未解析) → show everything at full strength (no demotion),
    // since we can't yet tell what the page is. Cards stay clickable — this is purely presentation.
    const kind = context.feishu?.kind
    const pageKind: 'table' | 'doc' | null =
      kind === 'base' || kind === 'sheet' ? 'table' : kind === 'doc' ? 'doc' : null
    const statusText =
      pageKind === 'table' ? `当前页面：${kind === 'base' ? '多维表格' : '电子表格'} · 已按这页排序`
      : pageKind === 'doc' ? '当前页面：飞书文档 · 已按这页排序'
      : kind === 'wiki' ? '正在识别知识库内容…解析后自动归类'
      : ''

    type Feat = { ic: string; title: string; desc: string; go: () => void }
    // 'content' = works on a doc OR a table (e.g. 幻灯片/PPT).
    type Grp = { key: string; label: string; requires: 'table' | 'doc' | 'any' | 'content'; feats: Feat[] }
    const groups: Grp[] = [
      { key: 'page', label: '把数据做成页面', requires: 'table', feats: [
        { ic: '🧩', title: 'AI 小程序', desc: '一句话把当前表做成 图表/报表/看板/计算器/幻灯片，渲染成页面浮窗；可保存，下次用最新数据一键打开', go: () => setView({ mode: 'dataviz' }) },
        { ic: '🌐', title: 'AI 建站', desc: '一句话把当前表做成一个完整网站页面，渲染成页面浮窗；离线自包含、自动符合风格；可保存、用最新数据一键打开', go: () => setView({ mode: 'aisite' }) },
      ] },
      { key: 'enrich', label: '数据加工与分析', requires: 'table', feats: [
        { ic: '🪄', title: '智能填充', desc: '选一列，AI 参考同行其它列推断空缺的值（分类 / 打标签 / 归类 / 补全），预览后一键写回多维表格', go: () => setView({ mode: 'smartfill' }) },
        { ic: '📈', title: '数据分析报告', desc: '读当前表的数据，AI 写一篇带真实数字的分析报告（摘要 / 关键发现 / 趋势 / 建议），生成飞书文档并附源数据表', go: () => setView({ mode: 'report' }) },
      ] },
      { key: 'doc', label: '文档处理', requires: 'doc', feats: [
        { ic: '🩺', title: '文档体检', desc: '通读当前文档，AI 找出逻辑断点 / 未定义术语 / 前后矛盾 / 遗留 TODO / 过期数据 / 空小节，给出可定位清单', go: () => setView({ mode: 'docaudit' }) },
        { ic: '📝', title: '文档总结', desc: '通读当前文档，按你的要求生成总结（摘要 / 要点 / 待办…）；总结要求可自定义、本机持久化', go: () => setView({ mode: 'docsummary' }) },
      ] },
      { key: 'slides', label: '演示 / PPT', requires: 'content', feats: [
        { ic: '🎞️', title: 'AI 幻灯片', desc: '把当前文档或表格先总结/分析，再做成多页幻灯片 PPT，渲染成页面浮窗——翻页 / 自动播放 / 深浅色 / 🖨 导出 PDF（AI 建站的一种输出）', go: () => setView({ mode: 'slides' }) },
      ] },
      { key: 'build', label: '搭建 / 建库', requires: 'any', feats: [
        { ic: '📚', title: '场景模版库', desc: '一键搭建 CRM / 电商 / 项目管理 等多维表格（含表结构、示例数据、仪表盘）', go: () => setView({ mode: 'gallery' }) },
      ] },
    ]
    // 'content' (PPT) works on a doc OR a table, so it's active whenever the page is either (and on
    // an unresolved/unknown page we show it too — the panel itself gates).
    const isActive = (g: Grp) => g.requires === 'any' || pageKind === null || g.requires === pageKind || (g.requires === 'content' && pageKind != null)
    // active page-matched group first (rank 0), then anywhere/content (rank 1), then dimmed (rank 2).
    const rank = (g: Grp) => (!isActive(g) ? 2 : g.requires === pageKind ? 0 : 1)
    const ordered = groups.map((g, i) => ({ g, i })).sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i)
    const reqLabel = (r: Grp['requires']) => (r === 'table' ? '需多维表格 / 电子表格' : r === 'doc' ? '需飞书文档' : r === 'content' ? '需文档 / 表格' : '')

    return (
      <div className="scenario-panel view-enter" key="hub">
        <div className="sc-hub">
          {statusText && <div className="sc-hub-status">{statusText}</div>}

          {ordered.map(({ g }) => {
            const dim = !isActive(g)
            return (
              <div key={g.key} className={`sc-hub-group${dim ? ' sc-hub-group--dim' : ''}`}>
                <div className="sc-hub-section">
                  {g.label}
                  {dim && <span className="sc-hub-req">{reqLabel(g.requires)}</span>}
                </div>
                {g.feats.map((f) => (
                  <button key={f.title} className="sc-hub-card sc-hub-card--entry" onClick={f.go}>
                    <span className="sc-hub-ic">{f.ic}</span>
                    <span className="sc-hub-body">
                      <span className="sc-hub-title">{f.title} <span className="sc-hub-arrow">→</span></span>
                      <span className="sc-hub-desc">{f.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            )
          })}

          {CLIP_ENABLED && (
            <div className="sc-hub-group">
              <div className="sc-hub-section">网页采集 · 在网页上右键触发</div>
              <div className="sc-hub-card sc-hub-card--info">
                <span className="sc-hub-ic">📎</span>
                <span className="sc-hub-body">
                  <span className="sc-hub-title">网页剪藏</span>
                  <span className="sc-hub-desc">任意网页右键「剪藏到飞书」→ 把表格 / 选中内容 AI 整理后写入多维表格 / 电子表格 / 文档</span>
                </span>
              </div>
              <div className="sc-hub-card sc-hub-card--info">
                <span className="sc-hub-ic">📊</span>
                <span className="sc-hub-body">
                  <span className="sc-hub-title">全量抓取</span>
                  <span className="sc-hub-desc">右键「剪藏整张表（滚动加载全部行）」→ 把虚拟滚动表格的所有行都抓下来</span>
                </span>
              </div>
              <div className="sc-hub-card sc-hub-card--info">
                <span className="sc-hub-ic">📷</span>
                <span className="sc-hub-body">
                  <span className="sc-hub-title">截图识别</span>
                  <span className="sc-hub-desc">右键「截图识别到飞书」→ 用视觉模型识别 canvas / 图片里的表格（需配置视觉模型）</span>
                </span>
              </div>
              <div className="sc-hub-card sc-hub-card--info">
                <span className="sc-hub-ic">📄</span>
                <span className="sc-hub-body">
                  <span className="sc-hub-title">文件导入</span>
                  <span className="sc-hub-desc">把 CSV / 表格文件直接拖进侧边栏 → AI 整理后写入飞书</span>
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (view.mode === 'dataviz') {
    return <DataVizPanel settings={settings} context={context} disabled={disabled} onBack={() => setView({ mode: 'hub' })} />
  }

  if (view.mode === 'aisite') {
    return <AISitePanel settings={settings} context={context} disabled={disabled} onBack={() => setView({ mode: 'hub' })} />
  }

  if (view.mode === 'smartfill') {
    return <SmartFillPanel settings={settings} context={context} disabled={disabled} onBack={() => setView({ mode: 'hub' })} />
  }

  if (view.mode === 'report') {
    return <DataReportPanel settings={settings} context={context} disabled={disabled} onBack={() => setView({ mode: 'hub' })} />
  }

  if (view.mode === 'docaudit') {
    return <DocAuditPanel settings={settings} context={context} disabled={disabled} onBack={() => setView({ mode: 'hub' })} />
  }

  if (view.mode === 'docsummary') {
    return <DocSummaryPanel settings={settings} context={context} disabled={disabled} onBack={() => setView({ mode: 'hub' })} />
  }

  if (view.mode === 'slides') {
    return <SlidesPanel settings={settings} context={context} disabled={disabled} onBack={() => setView({ mode: 'hub' })} />
  }

  if (view.mode === 'gallery') {
    const registryUrl = settings.templateRegistryUrl || DEFAULT_REGISTRY
    // First remote fetch hasn't merged yet → show skeletons instead of bare builtins.
    const initialLoading = refreshing && templates === BUILTIN_TEMPLATES
    return (
      <div className="scenario-panel view-enter" key="gallery">
        <button className="sc-back" onClick={() => setView({ mode: 'hub' })}>← 返回</button>
        <div className="sc-search-row">
          <input
            className="sc-search"
            placeholder="搜索场景模版…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="sc-cats">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              className={`sc-cat ${category === cat ? 'sc-cat--active' : ''}`}
              onClick={() => setCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="sc-list">
          {initialLoading ? (
            Array.from({ length: 4 }).map((_, i) => <TemplateCardSkeleton key={i} />)
          ) : (
            <>
              {filtered.length === 0 && (
                <div className="sc-empty">没有匹配的模版</div>
              )}
              {filtered.map(t => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  onClick={() => setView({ mode: 'detail', template: t })}
                />
              ))}
            </>
          )}
        </div>

        <div className="sc-registry-bar">
          {registryUrl ? (
            <>
              <span className="sc-registry-info">
                {cacheInfo
                  ? `更新于 ${timeAgo(cacheInfo.fetchedAt)}`
                  : '未缓存'}
              </span>
              <button
                className="sc-refresh-btn"
                onClick={() => registryUrl && loadRemote(registryUrl, true)}
                disabled={refreshing || !registryUrl}
              >
                {refreshing ? '更新中…' : '🔄 更新模版库'}
              </button>
            </>
          ) : (
            <span className="sc-registry-info">
              {DEFAULT_REGISTRY ? '模版市场' : '内置模版 · 在设置中配置模版库地址可获取更多'}
            </span>
          )}
          {refreshError && <span className="sc-refresh-err">{refreshError}</span>}
        </div>
      </div>
    )
  }

  // ── Detail (input form) ───────────────────────────────────────────────────

  if (view.mode === 'detail') {
    return (
      <DetailForm
        template={view.template}
        context={context}
        disabled={disabled}
        onBack={() => setView({ mode: 'gallery' })}
        onStart={(inputs) => launchTemplate(view.template, inputs)}
      />
    )
  }

  // ── Progress ──────────────────────────────────────────────────────────────

  if (view.mode === 'progress') {
    const failed = !!view.error
    const tpl = view.template
    const lastInputs = view.inputs
    return (
      <div className="scenario-panel scenario-panel--centered view-enter" key="progress">
        <div className="sc-progress-title">{failed ? '创建未完成' : '正在创建…'}</div>
        <div className="sc-steps">
          {view.steps.map(step => (
            <div key={step.id} className={`sc-step sc-step--${step.status}`}>
              <span className="sc-step-icon">
                {step.status === 'done' ? '✓' : step.status === 'error' ? '✕' : step.status === 'running' ? '⏳' : '○'}
              </span>
              <span className="sc-step-label">{step.label}</span>
              {step.detail && <span className="sc-step-detail">{step.detail}</span>}
            </div>
          ))}
        </div>

        {failed && (
          <>
            <div className="sc-error-box">
              <div className="sc-error-title">❌ 创建失败</div>
              <div className="sc-error-msg">{view.error}</div>
              <div className="sc-error-hint">已创建的部分（若有）不会自动删除，可按上方链接前往查看或在飞书中手动清理。</div>
            </div>
            <div className="sc-done-actions">
              {lastInputs && (
                <button className="btn-primary" onClick={() => launchTemplate(tpl, lastInputs)}>
                  重试
                </button>
              )}
              <button className="btn-secondary" onClick={() => setView({ mode: 'detail', template: tpl })}>
                返回上一步
              </button>
              <button className="btn-secondary" onClick={() => setView({ mode: 'gallery' })}>
                返回模版列表
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  // ── Done ─────────────────────────────────────────────────────────────────

  if (view.mode === 'done') {
    const { result } = view
    return (
      <div className="scenario-panel scenario-panel--centered view-enter" key="done">
        <div className="sc-done-icon">✅</div>
        <h3 className="sc-done-title">创建完成！</h3>
        <div className="sc-done-name">「{result.appName}」</div>

        <div className="sc-done-stats">
          <div className="sc-stat">
            <span className="sc-stat-num">{result.tables.length}</span>
            <span className="sc-stat-label">张数据表</span>
          </div>
          <div className="sc-stat">
            <span className="sc-stat-num">{result.totalRecords}</span>
            <span className="sc-stat-label">条示例数据</span>
          </div>
        </div>

        <div className="sc-done-tables">
          {result.tables.map(t => (
            <div key={t.ref} className="sc-done-table">
              <span>{t.name}</span>
              <span className="sc-done-check">✓</span>
            </div>
          ))}
        </div>

        {result.dashboardsCreated && result.dashboardsCreated.length > 0 && (
          <div className="sc-dash-created">
            {result.dashboardsCreated.map((name, i) => (
              <div key={i} className="sc-dash-created-item">
                <span>✅</span>
                <span>仪表盘「{name}」已自动创建并配置图表</span>
              </div>
            ))}
          </div>
        )}

        {result.dashboardWarnings && result.dashboardWarnings.length > 0 && (
          <div className="sc-dash-warnings">
            <p className="sc-dash-warn-title">📊 仪表盘需手动处理</p>
            {result.dashboardWarnings.map((w, i) => (
              <p key={i} className="sc-dash-warn-item">{w}</p>
            ))}
          </div>
        )}

        <a
          className="btn-open-feishu"
          href={result.appUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => { e.preventDefault(); openUrlInNewTab(result.appUrl) }}
        >
          在飞书中打开 ↗
        </a>

        <div className="sc-done-actions">
          <button className="btn-secondary" onClick={() => setView({ mode: 'gallery' })}>
            返回模版列表
          </button>
        </div>
      </div>
    )
  }

  return null
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function TemplateCard({
  template: t, onClick,
}: {
  template: ScenarioTemplate; onClick: () => void
}) {
  // Cover image is optional; fall back to the emoji icon if absent or it fails to load.
  const [coverFailed, setCoverFailed] = useState(false)
  // Only render http(s) covers — blocks a javascript:/data: src smuggled via a remote template.
  const coverSrc = safeImageSrc(t.cover)
  const showCover = !!coverSrc && !coverFailed
  // The whole card opens the detail/config view — browsing isn't gated by API keys;
  // the real gate is the "开始创建" button inside DetailForm.
  return (
    <div
      className="sc-card sc-card--clickable"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
    >
      <div className="sc-card-left">
        {showCover ? (
          <img
            className="sc-card-cover"
            src={coverSrc}
            alt=""
            loading="lazy"
            onError={() => setCoverFailed(true)}
          />
        ) : (
          <span className="sc-card-icon">{t.icon}</span>
        )}
      </div>
      <div className="sc-card-body">
        <div className="sc-card-title-row">
          <span className="sc-card-title">{t.name}</span>
          {t.source === 'remote' && <span className="sc-badge-remote">远程</span>}
        </div>
        <p className="sc-card-desc">{t.description}</p>
        <div className="sc-card-meta">
          {t.preview.tables} 张表 · {t.preview.views} 个视图 · {t.preview.records} 条示例
          {(t.preview.dashboards ?? 0) > 0 && ` · ${t.preview.dashboards} 个仪表盘`}
        </div>
      </div>
      <button
        className="sc-card-btn"
        onClick={(e) => { e.stopPropagation(); onClick() }}
        title="查看并创建"
      >
        查看
      </button>
    </div>
  )
}

function DetailForm({
  template, context, disabled, onBack, onStart,
}: {
  template: ScenarioTemplate
  context: PageContext
  disabled: boolean
  onBack: () => void
  onStart: (inputs: Record<string, string>) => void
}) {
  const initInputs = Object.fromEntries(
    template.inputs.map(inp => [inp.key, inp.default ?? ''])
  )
  const [inputs, setInputs] = useState<Record<string, string>>(initInputs)
  const [target, setTarget] = useState<'new_app' | 'current_app'>(template.target)

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setInputs(v => ({ ...v, [k]: e.target.value }))

  const canSubmit = template.inputs
    .filter(i => i.required)
    .every(i => inputs[i.key]?.trim())

  return (
    <div className="scenario-panel view-enter" key="detail">
      <div className="sc-detail-header">
        <button className="sc-back-btn" onClick={onBack}>← 返回</button>
        <span className="sc-detail-icon">{template.icon}</span>
        <h3 className="sc-detail-title">{template.name}</h3>
      </div>

      <div className="sc-detail-body">
        <p className="sc-detail-desc">{template.description}</p>

        {/* Preview */}
        <div className="sc-preview">
          <p className="sc-preview-label">将创建：</p>
          {template.tables.map(t => {
            const formulaCount = t.fields.filter(f => f.type === 20).length
            return (
              <div key={t.ref} className="sc-preview-item">
                <span className="sc-preview-dot">▸</span>
                <span>
                  {t.name}（{t.fields.length} 字段
                  {formulaCount > 0 ? `，含 ${formulaCount} 个公式` : ''}
                  {t.views?.length ? `，${t.views.length} 视图` : ''}
                  {t.sample_records?.length ? `，${t.sample_records.length} 条示例` : ''}）
                </span>
              </div>
            )
          })}
          {template.dashboards?.map(d => (
            <div key={d.name} className="sc-preview-item">
              <span className="sc-preview-dot sc-preview-dot--dash">📊</span>
              <span>仪表盘「{d.name}」（{d.blocks.length} 个图表）</span>
            </div>
          ))}
        </div>

        {/* Inputs */}
        {template.inputs.length > 0 && (
          <div className="sc-inputs">
            <p className="sc-inputs-label">配置</p>
            {template.inputs.map(inp => (
              <label key={inp.key} className="sc-input-field">
                <span className="sc-input-label">
                  {inp.label}{inp.required && <span className="sc-required">*</span>}
                </span>
                {inp.type === 'select' ? (
                  <select className="field-input" value={inputs[inp.key]} onChange={set(inp.key)}>
                    {inp.options?.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="field-input"
                    type="text"
                    value={inputs[inp.key]}
                    onChange={set(inp.key)}
                    placeholder={inp.placeholder}
                  />
                )}
              </label>
            ))}
          </div>
        )}

        {/* Target selector */}
        <div className="sc-target">
          <p className="sc-inputs-label">目标应用</p>
          <div className="sc-target-opts">
            <label className={`sc-target-opt ${target === 'new_app' ? 'sc-target-opt--active' : ''}`}>
              <input type="radio" name="target" value="new_app" checked={target === 'new_app'} onChange={() => setTarget('new_app')} />
              <span>🆕 创建新应用</span>
            </label>
            <label className={`sc-target-opt ${target === 'current_app' ? 'sc-target-opt--active' : ''} ${!context.feishu?.isBase ? 'sc-target-opt--disabled' : ''}`}>
              <input type="radio" name="target" value="current_app" disabled={!context.feishu?.isBase} checked={target === 'current_app'} onChange={() => setTarget('current_app')} />
              <span>📂 当前 Base{!context.feishu?.isBase ? '（未打开）' : ''}</span>
            </label>
          </div>
        </div>

        <button
          className="btn-create"
          disabled={disabled || !canSubmit}
          onClick={() => onStart({ ...inputs, _target: target })}
        >
          {disabled ? '请先配置 API Keys' : '开始创建 →'}
        </button>
      </div>
    </div>
  )
}

// ─── Template execution ───────────────────────────────────────────────────────

async function runTemplate(
  template: ScenarioTemplate,
  inputs: Record<string, string>,
  settings: AppSettings,
  context: PageContext,
  onProgress: (steps: ProgressStep[]) => void
): Promise<CreationResult> {
  const token = await resolveToken(settings)
  const target = (inputs._target as 'new_app' | 'current_app') ?? template.target
  const tpl = { ...template, target }

  // DOM automation is only reliable when we're already on the target Base page
  const createDashboard = target === 'current_app'
    ? async (name: string): Promise<string | null> => {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
          if (!tab?.id) return null
          const result = await chrome.tabs.sendMessage(tab.id, { type: 'CREATE_DASHBOARD_UI', name })
          return (result as { blockToken?: string } | null)?.blockToken ?? null
        } catch {
          return null
        }
      }
    : undefined

  return executeTemplate(
    tpl, inputs, token, context.feishu?.appToken, onProgress, createDashboard,
    context.url, settings.feishuOwnerOpenId?.trim() || undefined
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return `${Math.floor(s / 86400)} 天前`
}
