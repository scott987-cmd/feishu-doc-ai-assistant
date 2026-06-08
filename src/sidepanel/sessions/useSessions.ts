import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage, SessionIndex, SessionMeta } from '../../shared/types'
import * as store from './store'
import { emptyIndex, ensureSession as ensureSessionPure, removeSession as removeSessionPure, capSessions } from './logic'

const uid = () => crypto.randomUUID()
const now = () => Date.now()
const FLUSH_MS = 800

type Updater = ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])

export interface SessionsApi {
  ready: boolean
  index: SessionIndex
  activeSession: SessionMeta | null
  messages: ChatMessage[]
  setMessages: (u: Updater) => void
  /** Write to a specific session (bind a streaming reply to the session it began in). */
  setMessagesFor: (sessionId: string, u: Updater) => void
  switchTo: (id: string) => void
  createSession: () => void
  removeSession: (id: string) => void
  renameSession: (id: string, title: string) => void
  /** Backfill a document session's placeholder title with the real Base name. */
  resolveTitle: (appToken: string, title: string) => void
}

/**
 * Multi-session manager. Sessions are persisted to chrome.storage.local; the one
 * shown follows the current document (appToken) — switching documents auto-opens
 * that document's recorded session. A general session covers non-Base pages.
 * Auto-switch is deferred while `streaming` so an in-flight reply finishes in its
 * own session before the view follows browser navigation.
 */
export function useSessions(activeAppToken: string | null, streaming: boolean): SessionsApi {
  const [index, setIndex] = useState<SessionIndex>(emptyIndex())
  const [messages, setMessagesState] = useState<ChatMessage[]>([])
  const [ready, setReady] = useState(false)

  const indexRef = useRef(index)
  indexRef.current = index
  const activeIdRef = useRef<string | null>(null)
  const cache = useRef<Map<string, ChatMessage[]>>(new Map())
  const flushTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const persistIndex = useCallback((idx: SessionIndex) => {
    indexRef.current = idx
    setIndex(idx)
    void store.saveIndex(idx)
  }, [])

  // Persist an index but first cap the number of conversation WINDOWS (keeping the
  // active/just-opened one), dropping the evicted sessions' stored messages.
  const persistCapped = useCallback((idx: SessionIndex, keepId: string | null) => {
    const { idx: capped, removed } = capSessions(idx, keepId)
    persistIndex(capped)
    for (const id of removed) {
      // Cancel any pending debounced flush — else it fires up to FLUSH_MS later and re-creates
      // the just-deleted blob (an orphan with no index entry, never swept).
      const t = flushTimers.current.get(id)
      if (t) { clearTimeout(t); flushTimers.current.delete(id) }
      cache.current.delete(id)
      void store.removeMessages(id)
    }
  }, [persistIndex])

  // Synchronously persist every session with a pending debounced write (final streamed reply
  // is otherwise only saved 800ms after the last chunk — closing the panel in that window loses
  // it). Best-effort on teardown (storage.set is async), but strictly better than zero attempts.
  const flushAll = useCallback(() => {
    const timers = flushTimers.current
    if (!timers.size) return
    const flushed = [...timers.keys()]
    for (const [sessionId, t] of timers) {
      clearTimeout(t)
      void store.saveMessages(sessionId, cache.current.get(sessionId) ?? [])
    }
    timers.clear()
    const idx = indexRef.current
    const sessions = idx.sessions.map((s) =>
      flushed.includes(s.id) ? { ...s, updatedAt: now(), messageCount: (cache.current.get(s.id) ?? []).length } : s
    )
    persistIndex({ ...idx, sessions })
  }, [persistIndex])

  const loadInto = useCallback(async (id: string) => {
    activeIdRef.current = id
    const cached = cache.current.get(id)
    if (cached) { setMessagesState(cached); return }
    const msgs = await store.loadMessages(id) // full history — no per-session message cap
    cache.current.set(id, msgs)
    if (activeIdRef.current === id) setMessagesState(msgs)
  }, [])

  const ensureSession = useCallback(
    (idx: SessionIndex, appToken: string | null) => ensureSessionPure(idx, appToken, uid),
    []
  )

  // Initial load — restore the index and open the session for the current context.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const loaded = (await store.loadIndex()) ?? emptyIndex()
      if (cancelled) return
      const { idx, id } = ensureSession(loaded, activeAppToken)
      persistCapped({ ...idx, activeId: id }, id)
      await loadInto(id)
      if (!cancelled) setReady(true)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-switch when the document changes (deferred until streaming ends).
  useEffect(() => {
    if (!ready || streaming) return
    const { idx, id } = ensureSession(indexRef.current, activeAppToken)
    if (idx !== indexRef.current || idx.activeId !== id) persistCapped({ ...idx, activeId: id }, id)
    void loadInto(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAppToken, ready, streaming])

  useEffect(() => { activeIdRef.current = index.activeId }, [index.activeId])

  // Flush pending writes when the panel is hidden/closed (the MV3 side panel tears down its JS
  // context on close), and immediately when a streamed turn finishes (the most important write).
  const prevStreaming = useRef(streaming)
  useEffect(() => {
    if (prevStreaming.current && !streaming) flushAll()
    prevStreaming.current = streaming
  }, [streaming, flushAll])
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushAll() }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flushAll)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flushAll)
    }
  }, [flushAll])

  // Write to a SPECIFIC session — the source of truth is the per-session cache, so a
  // streaming reply always lands in the session it started in (bind at send time),
  // never the currently-active one if it switched mid-stream. Each session flushes
  // on its own debounce timer.
  const setMessagesFor = useCallback((sessionId: string, u: Updater) => {
    const prev = cache.current.get(sessionId) ?? []
    // Full history kept — no per-session message cap (windows are capped instead).
    const next = typeof u === 'function' ? (u as (p: ChatMessage[]) => ChatMessage[])(prev) : u
    cache.current.set(sessionId, next)

    const timers = flushTimers.current
    const existing = timers.get(sessionId)
    if (existing) clearTimeout(existing)
    timers.set(sessionId, setTimeout(() => {
      void store.saveMessages(sessionId, next)
      const idx = indexRef.current
      const sessions = idx.sessions.map((s) =>
        s.id === sessionId ? { ...s, updatedAt: now(), messageCount: next.length } : s
      )
      persistIndex({ ...idx, sessions })
      timers.delete(sessionId)
    }, FLUSH_MS))

    if (sessionId === activeIdRef.current) setMessagesState(next)
  }, [persistIndex])

  const setMessages = useCallback((u: Updater) => {
    const id = activeIdRef.current
    if (id) setMessagesFor(id, u)
  }, [setMessagesFor])

  const switchTo = useCallback((id: string) => {
    const idx = indexRef.current
    if (!idx.sessions.some((s) => s.id === id) || idx.activeId === id) {
      if (idx.activeId !== id && idx.sessions.some((s) => s.id === id)) {
        persistIndex({ ...idx, activeId: id })
      }
      void loadInto(id)
      return
    }
    persistIndex({ ...idx, activeId: id })
    void loadInto(id)
  }, [persistIndex, loadInto])

  const createSession = useCallback(() => {
    const meta: SessionMeta = {
      id: uid(), title: '新会话', appToken: null,
      createdAt: now(), updatedAt: now(), messageCount: 0, titleResolved: true,
    }
    cache.current.set(meta.id, [])
    activeIdRef.current = meta.id
    setMessagesState([])
    persistCapped({ ...indexRef.current, sessions: [meta, ...indexRef.current.sessions], activeId: meta.id }, meta.id)
  }, [persistCapped])

  const removeSession = useCallback((id: string) => {
    const { idx, activeId } = removeSessionPure(indexRef.current, id, activeAppToken, uid)
    if (idx === indexRef.current) return // nothing removed
    persistIndex(idx)
    const t = flushTimers.current.get(id)
    if (t) { clearTimeout(t); flushTimers.current.delete(id) } // don't let a pending flush re-create the deleted blob
    cache.current.delete(id)
    void store.removeMessages(id)
    if (activeId) void loadInto(activeId)
  }, [persistIndex, loadInto, activeAppToken])

  const renameSession = useCallback((id: string, title: string) => {
    const t = title.trim()
    if (!t) return
    const idx = indexRef.current
    persistIndex({
      ...idx,
      sessions: idx.sessions.map((s) => (s.id === id ? { ...s, title: t, titleResolved: true } : s)),
    })
  }, [persistIndex])

  const resolveTitle = useCallback((appToken: string, title: string) => {
    const idx = indexRef.current
    const id = idx.byAppToken[appToken]
    if (!id) return
    const target = idx.sessions.find((s) => s.id === id)
    if (!target || target.titleResolved || target.title === title) return
    persistIndex({
      ...idx,
      sessions: idx.sessions.map((s) => (s.id === id ? { ...s, title, titleResolved: true } : s)),
    })
  }, [persistIndex])

  const activeSession = index.sessions.find((s) => s.id === index.activeId) ?? null

  return {
    ready, index, activeSession, messages,
    setMessages, setMessagesFor, switchTo, createSession, removeSession, renameSession, resolveTitle,
  }
}
