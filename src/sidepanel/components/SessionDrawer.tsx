import { useState } from 'react'
import type { SessionMeta } from '../../shared/types'
import type { SessionsApi } from '../sessions/useSessions'
import './SessionDrawer.css'

interface Props {
  sessions: SessionsApi
  /** Disable switching/new while a reply is streaming (avoids cross-session writes). */
  busy: boolean
  onClose: () => void
}

export default function SessionDrawer({ sessions, busy, onClose }: Props) {
  const { index, switchTo, createSession, removeSession, renameSession } = sessions
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const ordered = [...index.sessions].sort((a, b) => b.updatedAt - a.updatedAt)

  function commitRename(id: string) {
    if (draft.trim()) renameSession(id, draft)
    setEditingId(null)
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer view-enter" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <span className="drawer-title">会话</span>
          <button className="drawer-x" onClick={onClose} title="关闭">✕</button>
        </div>

        <button
          className="drawer-new"
          onClick={() => { if (!busy) { createSession(); onClose() } }}
          disabled={busy}
          title={busy ? '回复进行中，请稍候' : '新建一个会话'}
        >
          ＋ 新建会话
        </button>

        <div className="drawer-list">
          {ordered.map((s) => (
            <SessionRow
              key={s.id}
              meta={s}
              active={s.id === index.activeId}
              busy={busy}
              editing={editingId === s.id}
              draft={draft}
              onPick={() => { if (!busy) { switchTo(s.id); onClose() } }}
              onStartRename={() => { setEditingId(s.id); setDraft(s.title) }}
              onDraft={setDraft}
              onCommit={() => commitRename(s.id)}
              onCancelRename={() => setEditingId(null)}
              onDelete={() => removeSession(s.id)}
            />
          ))}
        </div>
        {busy && <p className="drawer-hint">回复进行中，暂不能切换会话</p>}
      </div>
    </div>
  )
}

function SessionRow({
  meta, active, busy, editing, draft,
  onPick, onStartRename, onDraft, onCommit, onCancelRename, onDelete,
}: {
  meta: SessionMeta
  active: boolean
  busy: boolean
  editing: boolean
  draft: string
  onPick: () => void
  onStartRename: () => void
  onDraft: (v: string) => void
  onCommit: () => void
  onCancelRename: () => void
  onDelete: () => void
}) {
  return (
    <div className={`drawer-row ${active ? 'drawer-row--active' : ''}`}>
      <span className="drawer-row-ic">{meta.appToken ? '📄' : '💬'}</span>
      {editing ? (
        <input
          className="drawer-rename"
          autoFocus
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommit()
            if (e.key === 'Escape') onCancelRename()
          }}
          onBlur={onCommit}
        />
      ) : (
        <button className="drawer-row-main" onClick={onPick} disabled={busy}>
          <span className="drawer-row-title">{meta.title}</span>
          <span className="drawer-row-meta">{meta.messageCount} 条 · {timeAgo(meta.updatedAt)}</span>
        </button>
      )}
      {!editing && (
        <span className="drawer-row-actions">
          <button className="drawer-row-btn" onClick={onStartRename} title="重命名">✎</button>
          <button className="drawer-row-btn" onClick={onDelete} title="删除">🗑</button>
        </span>
      )}
    </div>
  )
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return `${Math.floor(s / 86400)} 天前`
}
