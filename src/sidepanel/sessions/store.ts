/**
 * Session persistence on chrome.storage.local. Sharded so writing one session's
 * messages doesn't reserialize every session:
 *   sessions_index_v1            → SessionIndex (light, frequent read)
 *   session_msgs_v1::<id>        → ChatMessage[] (per session, lazy read / throttled write)
 */
import type { ChatMessage, SessionIndex } from '../../shared/types'

const IDX_KEY = 'sessions_index_v1'
const MSG_PREFIX = 'session_msgs_v1::'

function get<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) =>
    chrome.storage.local.get([key], (r) => resolve(r[key] as T | undefined))
  )
}

function set(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set(items, () => resolve()))
}

export async function loadIndex(): Promise<SessionIndex | undefined> {
  try {
    return await get<SessionIndex>(IDX_KEY)
  } catch {
    return undefined
  }
}

export function saveIndex(index: SessionIndex): Promise<void> {
  return set({ [IDX_KEY]: index })
}

export async function loadMessages(id: string): Promise<ChatMessage[]> {
  return (await get<ChatMessage[]>(MSG_PREFIX + id)) ?? []
}

export function saveMessages(id: string, messages: ChatMessage[]): Promise<void> {
  return set({ [MSG_PREFIX + id]: messages })
}

export function removeMessages(id: string): Promise<void> {
  const local = chrome.storage.local as typeof chrome.storage.local & {
    remove?: (keys: string | string[], cb?: () => void) => void
  }
  if (typeof local.remove === 'function') {
    return new Promise((resolve) => local.remove!(MSG_PREFIX + id, () => resolve()))
  }
  // Fallback (e.g. dev mock without remove): logically empty it.
  return set({ [MSG_PREFIX + id]: [] })
}
