// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ChatMessage } from '../../shared/types'
import { useSessions } from './useSessions'

// In-memory chrome.storage.local mock.
let mem: Record<string, unknown>
beforeEach(() => {
  mem = {}
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: (keys: string[], cb: (r: Record<string, unknown>) => void) => {
          const r: Record<string, unknown> = {}
          for (const k of keys) if (k in mem) r[k] = mem[k]
          cb(r)
        },
        set: (items: Record<string, unknown>, cb?: () => void) => { Object.assign(mem, items); cb?.() },
        remove: (keys: string | string[], cb?: () => void) => {
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete mem[k]); cb?.()
        },
      },
    },
  }
})

const msg = (content: string): ChatMessage =>
  ({ id: Math.random().toString(), role: 'user', content, createdAt: 0 })

function renderSessions(initialToken: string | null) {
  return renderHook(({ t }) => useSessions(t, false), { initialProps: { t: initialToken } })
}

describe('useSessions', () => {
  it('binds a session to the current Base appToken', async () => {
    const { result } = renderSessions('appA')
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.activeSession?.appToken).toBe('appA')
  })

  it('keeps per-document sessions isolated and restores on return', async () => {
    const { result, rerender } = renderSessions('appA')
    await waitFor(() => expect(result.current.ready).toBe(true))
    const idA = result.current.activeSession!.id

    act(() => result.current.setMessages([msg('hello A')]))
    expect(result.current.messages).toHaveLength(1)

    // Switch to another document → fresh, empty session
    rerender({ t: 'appB' })
    await waitFor(() => expect(result.current.activeSession?.appToken).toBe('appB'))
    expect(result.current.messages).toHaveLength(0)

    // Switch back → original session + messages restored
    rerender({ t: 'appA' })
    await waitFor(() => expect(result.current.activeSession?.id).toBe(idA))
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0].content).toBe('hello A')
  })

  it('uses a single general session for non-Base (null) context', async () => {
    const { result } = renderSessions(null)
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.activeSession?.appToken).toBeNull()
    expect(result.current.activeSession?.title).toBe('通用会话')
  })

  it('resolveTitle backfills the document session title (Base name)', async () => {
    const { result } = renderSessions('appA')
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => result.current.resolveTitle('appA', '人员管理系统'))
    await waitFor(() =>
      expect(result.current.index.sessions.find((s) => s.appToken === 'appA')?.title).toBe('人员管理系统')
    )
  })

  it('setMessagesFor writes to a specific session even when another is active', async () => {
    const { result, rerender } = renderSessions('appA')
    await waitFor(() => expect(result.current.ready).toBe(true))
    const idA = result.current.activeSession!.id

    // Switch active session to appB (simulating navigation mid-stream)
    rerender({ t: 'appB' })
    await waitFor(() => expect(result.current.activeSession?.appToken).toBe('appB'))

    // A streaming reply that began in A writes to idA, NOT the now-active B
    act(() => result.current.setMessagesFor(idA, [msg('reply in A')]))
    expect(result.current.messages).toHaveLength(0) // active (B) display untouched

    // Back to A → the reply landed there (no cross-contamination)
    rerender({ t: 'appA' })
    await waitFor(() => expect(result.current.activeSession?.id).toBe(idA))
    expect(result.current.messages.map((m) => m.content)).toContain('reply in A')
  })

  it('createSession adds a new active session', async () => {
    const { result } = renderSessions('appA')
    await waitFor(() => expect(result.current.ready).toBe(true))
    const before = result.current.index.sessions.length
    act(() => result.current.createSession())
    await waitFor(() => expect(result.current.index.sessions.length).toBe(before + 1))
    expect(result.current.messages).toHaveLength(0)
  })
})
