import { describe, it, expect } from 'vitest'
import type { SessionIndex, SessionMeta } from '../../shared/types'
import { emptyIndex, ensureSession, removeSession, capSessions, MAX_SESSIONS } from './logic'

// Deterministic id generator for assertions.
function ids() {
  let n = 0
  return () => `s${++n}`
}

describe('ensureSession', () => {
  it('creates a document session bound to appToken and indexes it', () => {
    const { idx, id, created } = ensureSession(emptyIndex(), 'appA', ids())
    expect(created).toBe(true)
    expect(id).toBe('s1')
    expect(idx.byAppToken).toEqual({ appA: 's1' })
    expect(idx.sessions[0]).toMatchObject({ appToken: 'appA', titleResolved: false })
  })

  it('reuses the existing session for the same appToken', () => {
    const first = ensureSession(emptyIndex(), 'appA', ids())
    const again = ensureSession(first.idx, 'appA', ids())
    expect(again.created).toBe(false)
    expect(again.id).toBe('s1')
    expect(again.idx).toBe(first.idx) // unchanged
  })

  it('creates and reuses a single general session for null appToken', () => {
    const gen = ids()
    const a = ensureSession(emptyIndex(), null, gen)
    expect(a.idx.generalId).toBe('s1')
    expect(a.idx.sessions[0]).toMatchObject({ appToken: null, title: '通用会话', titleResolved: true })
    const b = ensureSession(a.idx, null, gen)
    expect(b.created).toBe(false)
    expect(b.id).toBe('s1')
  })

  it('keeps document and general sessions separate', () => {
    const gen = ids()
    const doc = ensureSession(emptyIndex(), 'appA', gen)
    const both = ensureSession(doc.idx, null, gen)
    expect(both.idx.sessions).toHaveLength(2)
    expect(both.idx.byAppToken).toEqual({ appA: 's1' })
    expect(both.idx.generalId).toBe('s2')
  })
})

describe('removeSession', () => {
  it('removes a non-active session and clears its appToken index', () => {
    const gen = ids()
    let idx = ensureSession(emptyIndex(), 'appA', gen).idx   // s1 (doc appA)
    idx = ensureSession(idx, null, gen).idx                  // s2 (general)
    idx = { ...idx, activeId: idx.generalId }                // general active
    const out = removeSession(idx, idx.byAppToken['appA'], null, gen)
    expect(out.idx.sessions.some((s) => s.appToken === 'appA')).toBe(false)
    expect(out.idx.byAppToken['appA']).toBeUndefined()
    expect(out.activeId).toBe(idx.generalId) // active unchanged
  })

  it('falls back to the current document session when the active one is deleted', () => {
    const gen = ids()
    let idx = ensureSession(emptyIndex(), 'appA', gen).idx
    idx = { ...idx, activeId: idx.byAppToken['appA'] }
    // delete the active doc session while still on appA → a fresh appA session is created
    const out = removeSession(idx, idx.byAppToken['appA'], 'appA', gen)
    expect(out.activeId).toBeTruthy()
    expect(out.idx.byAppToken['appA']).toBe(out.activeId)
    expect(out.idx.sessions.find((s) => s.id === out.activeId)?.messageCount).toBe(0) // brand new
  })

  it('is a no-op for an unknown id', () => {
    const idx = ensureSession(emptyIndex(), 'appA', ids()).idx
    const out = removeSession(idx, 'nope', null, ids())
    expect(out.idx).toBe(idx)
  })
})

describe('capSessions — bound the number of conversation WINDOWS (not messages)', () => {
  const sess = (id: string, updatedAt: number, appToken: string | null = null): SessionMeta =>
    ({ id, title: id, appToken, createdAt: 0, updatedAt, messageCount: 0, titleResolved: true })
  const mk = (metas: SessionMeta[], activeId: string | null = null): SessionIndex => ({
    sessions: metas, activeId, generalId: null,
    byAppToken: Object.fromEntries(metas.filter((m) => m.appToken).map((m) => [m.appToken as string, m.id])),
  })

  it('no-op when within the cap', () => {
    const idx = mk([sess('a', 1), sess('b', 2)])
    expect(capSessions(idx, null, 20)).toEqual({ idx, removed: [] })
  })

  it('evicts the OLDEST windows beyond the cap', () => {
    const metas = Array.from({ length: 22 }, (_, i) => sess(`s${i}`, i))
    const { idx, removed } = capSessions(mk(metas), null, 20)
    expect(idx.sessions).toHaveLength(20)
    expect(removed).toEqual(['s0', 's1']) // two oldest dropped
  })

  it('never evicts the active or kept session even if oldest', () => {
    const metas = Array.from({ length: 22 }, (_, i) => sess(`s${i}`, i))
    const { idx, removed } = capSessions(mk(metas, 's0'), 's1', 20)
    expect(removed).not.toContain('s0') // active
    expect(removed).not.toContain('s1') // keepId
    expect(idx.sessions).toHaveLength(20)
  })

  it('drops evicted sessions from byAppToken too', () => {
    const metas = Array.from({ length: 21 }, (_, i) => sess(`s${i}`, i, `app${i}`))
    const { idx, removed } = capSessions(mk(metas), null, 20)
    expect(removed).toEqual(['s0'])
    expect(idx.byAppToken['app0']).toBeUndefined()
  })

  it('defaults to MAX_SESSIONS (20)', () => {
    expect(MAX_SESSIONS).toBe(20)
    expect(capSessions(mk(Array.from({ length: 25 }, (_, i) => sess(`s${i}`, i)))).idx.sessions).toHaveLength(20)
  })
})
