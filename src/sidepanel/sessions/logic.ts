/**
 * Pure reducers over SessionIndex — the trickiest part of session management
 * (find-or-create by document, byAppToken bookkeeping, delete fallback). Kept
 * side-effect-free so they can be unit-tested without React or chrome.storage.
 */
import type { SessionIndex, SessionMeta } from '../../shared/types'

const now = () => Date.now()

/** Max conversation WINDOWS (sessions) kept; the oldest are evicted beyond this. Messages
 *  WITHIN a session are NOT capped — full history is preserved. */
export const MAX_SESSIONS = 20

/**
 * Keep at most MAX_SESSIONS conversation windows, evicting the OLDEST by `updatedAt`.
 * Never evicts the active session or `keepId` (the just-created/opened one). Returns the
 * trimmed index plus the removed session ids so the caller can drop their stored messages.
 */
export function capSessions(
  idx: SessionIndex,
  keepId: string | null = null,
  max: number = MAX_SESSIONS,
): { idx: SessionIndex; removed: string[] } {
  if (idx.sessions.length <= max) return { idx, removed: [] }
  const protectedIds = new Set([idx.activeId, keepId].filter(Boolean) as string[])
  const oldestFirst = [...idx.sessions].sort((a, b) => a.updatedAt - b.updatedAt)
  const removed: string[] = []
  let remaining = idx.sessions.length
  for (const s of oldestFirst) {
    if (remaining <= max) break
    if (protectedIds.has(s.id)) continue
    removed.push(s.id)
    remaining--
  }
  if (!removed.length) return { idx, removed: [] }
  const gone = new Set(removed)
  const sessions = idx.sessions.filter((s) => !gone.has(s.id))
  const byAppToken: Record<string, string> = {}
  for (const [k, v] of Object.entries(idx.byAppToken)) if (!gone.has(v)) byAppToken[k] = v
  const generalId = idx.generalId && gone.has(idx.generalId) ? null : idx.generalId
  return { idx: { ...idx, sessions, byAppToken, generalId }, removed }
}

export function emptyIndex(): SessionIndex {
  return { sessions: [], activeId: null, byAppToken: {}, generalId: null }
}

function meta(partial: Partial<SessionMeta> & { id: string; title: string; appToken: string | null }): SessionMeta {
  const t = now()
  return { createdAt: t, updatedAt: t, messageCount: 0, titleResolved: false, ...partial }
}

/**
 * Return the session bound to `appToken` (or the general session when null),
 * creating it if missing. `newId` lets tests inject deterministic ids.
 */
export function ensureSession(
  idx: SessionIndex,
  appToken: string | null,
  newId: () => string
): { idx: SessionIndex; id: string; created: boolean } {
  if (appToken) {
    const existing = idx.byAppToken[appToken]
    if (existing && idx.sessions.some((s) => s.id === existing)) return { idx, id: existing, created: false }
    const m = meta({ id: newId(), title: `会话 ${appToken.slice(0, 8)}…`, appToken })
    return {
      idx: { ...idx, sessions: [m, ...idx.sessions], byAppToken: { ...idx.byAppToken, [appToken]: m.id } },
      id: m.id,
      created: true,
    }
  }
  if (idx.generalId && idx.sessions.some((s) => s.id === idx.generalId)) {
    return { idx, id: idx.generalId, created: false }
  }
  const m = meta({ id: newId(), title: '通用会话', appToken: null, titleResolved: true })
  return { idx: { ...idx, sessions: [m, ...idx.sessions], generalId: m.id }, id: m.id, created: true }
}

/**
 * Remove a session and compute the fallback active id. If the removed session was
 * active, fall back to the current document's session (recreated if needed) or the
 * general session.
 */
export function removeSession(
  idx: SessionIndex,
  id: string,
  currentAppToken: string | null,
  newId: () => string
): { idx: SessionIndex; activeId: string | null } {
  const target = idx.sessions.find((s) => s.id === id)
  if (!target) return { idx, activeId: idx.activeId }

  const byAppToken = { ...idx.byAppToken }
  if (target.appToken) delete byAppToken[target.appToken]
  let next: SessionIndex = {
    ...idx,
    sessions: idx.sessions.filter((s) => s.id !== id),
    byAppToken,
    generalId: idx.generalId === id ? null : idx.generalId,
  }

  let activeId = idx.activeId
  if (activeId === id) {
    const ensured = ensureSession(next, currentAppToken, newId)
    next = ensured.idx
    activeId = ensured.id
  }
  return { idx: { ...next, activeId }, activeId }
}
