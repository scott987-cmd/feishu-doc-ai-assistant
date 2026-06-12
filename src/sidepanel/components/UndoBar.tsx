import { useEffect, useRef, useState } from 'react'
import type { AppSettings } from '../../shared/types'
import { loadDeleteUndo, clearDeleteUndo, restoreDeleteUndo, type UndoView } from '../../shared/feishu/undo'
import { resolveToken } from '../../shared/feishu/auth'
import { reloadActiveTab } from '../tabReload'

/**
 * A slim "↩ 撤销删除" bar shown after the assistant deletes records. It reads the undo entry the
 * agent stashes (and live-updates via storage.onChanged), and re-creates the deleted rows on click
 * — so operating on important tables feels safe (there's a one-click 后悔药).
 */
export default function UndoBar({ settings }: { settings: AppSettings }) {
  const [undo, setUndo] = useState<UndoView | null>(null)
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
      await clearDeleteUndo(); setUndo(null); flash(`已恢复 ${n} 项，正在刷新页面…`)
      reloadActiveTab() // the Feishu page caches — reload so the restored rows actually show
    } catch (e) {
      flash('恢复失败：' + (e instanceof Error ? e.message : String(e)))
    } finally { setBusy(false) }
  }
  async function dismiss() { await clearDeleteUndo(); setUndo(null) }

  if (!undo && !note) return null
  const isErr = note.startsWith('恢复失败')
  return (
    <>
      {undo && (
        <div style={bar}>
          <span style={{ flex: 1 }}>🗑 {undo.label} · 误删了？可一键恢复</span>
          <button style={btn} disabled={busy} onClick={() => void restore()}>{busy ? '恢复中…' : '↩ 撤销'}</button>
          <button style={x} onClick={() => void dismiss()} title="不撤销，关闭">✕</button>
        </div>
      )}
      {/* Show success / failure even while the undo bar is still up — otherwise a failed restore
          looked like "nothing happened" (the error was set but hidden behind the bar). */}
      {note && <div style={{ ...bar, background: isErr ? '#fff1f0' : '#f6ffed', color: isErr ? '#cf1322' : '#389e0d' }}>{note}</div>}
    </>
  )
}

const bar: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, margin: '8px 12px', padding: '8px 12px',
  background: '#fff7e6', color: '#874d00', fontSize: 12, border: '1px solid #ffe7ba', borderRadius: 8,
}
const btn: React.CSSProperties = {
  border: 'none', background: '#4f6bff', color: '#fff', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 12,
}
const x: React.CSSProperties = { border: 'none', background: 'transparent', color: '#999', cursor: 'pointer', fontSize: 13 }
