import { useEffect, useRef, useState } from 'react'
import type { AppSettings } from '../../shared/types'
import { loadDeleteUndo, clearDeleteUndo, restoreDeleteUndo, type DeleteUndo } from '../../shared/feishu/undo'
import { resolveToken } from '../../shared/feishu/auth'

/**
 * A slim "↩ 撤销删除" bar shown after the assistant deletes records. It reads the undo entry the
 * agent stashes (and live-updates via storage.onChanged), and re-creates the deleted rows on click
 * — so operating on important tables feels safe (there's a one-click 后悔药).
 */
export default function UndoBar({ settings }: { settings: AppSettings }) {
  const [undo, setUndo] = useState<DeleteUndo | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const flash = (m: string) => {
    setNote(m); clearTimeout(noteTimer.current); noteTimer.current = setTimeout(() => setNote(''), 5000)
  }
  const refresh = () => { void loadDeleteUndo().then(setUndo) }

  useEffect(() => {
    refresh()
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes._last_delete_undo_v1) refresh()
    }
    try { chrome.storage?.onChanged?.addListener(onChanged) } catch { /* no storage in dev mock */ }
    return () => { try { chrome.storage?.onChanged?.removeListener(onChanged) } catch { /* ignore */ } }
  }, [])

  async function restore() {
    if (!undo || busy) return
    setBusy(true)
    try {
      const n = await restoreDeleteUndo(await resolveToken(settings), undo)
      await clearDeleteUndo(); setUndo(null); flash(`已恢复 ${n} 条记录`)
    } catch (e) {
      flash('恢复失败：' + (e instanceof Error ? e.message : String(e)))
    } finally { setBusy(false) }
  }
  async function dismiss() { await clearDeleteUndo(); setUndo(null) }

  if (!undo) return note ? <div style={{ ...bar, background: '#f6ffed', color: '#389e0d' }}>{note}</div> : null

  return (
    <div style={bar}>
      <span style={{ flex: 1 }}>🗑 {undo.label} · 误删了？可一键恢复</span>
      <button style={btn} disabled={busy} onClick={() => void restore()}>{busy ? '恢复中…' : '↩ 撤销'}</button>
      <button style={x} onClick={() => void dismiss()} title="不撤销，关闭">✕</button>
    </div>
  )
}

const bar: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
  background: '#fff7e6', color: '#874d00', fontSize: 12, borderBottom: '1px solid #ffe7ba',
}
const btn: React.CSSProperties = {
  border: 'none', background: '#4f6bff', color: '#fff', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 12,
}
const x: React.CSSProperties = { border: 'none', background: 'transparent', color: '#999', cursor: 'pointer', fontSize: 13 }
