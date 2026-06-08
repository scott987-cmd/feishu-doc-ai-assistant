import type { Slide } from './slides'
import type { VizSource } from '../dataviz/types'

/**
 * Saved slide decks (AI 幻灯片 / PPT). Local-only, like saved vizzes — so a generated PPT can be
 * REOPENED without regenerating (no LLM cost). The deck content (slides) is the artifact; for a
 * table deck with embed (看板) slides we keep `source` so the rows can be re-fetched live on open.
 */
export interface SavedDeck {
  id: string
  name: string
  /** Which page it belongs to: a doc's documentId, or a Base/Sheet's ctxDocKey ('base:'/'sheet:'). */
  srcKey: string
  slides: Slide[]
  /** Table source (Base/Sheet) → re-fetch rows for embed slides on open. Absent for doc decks. */
  source?: VizSource
  createdAt: number
}

const KEY = 'slides_decks_v1'

function get(): Promise<SavedDeck[]> {
  return new Promise((res) => {
    try {
      if (typeof chrome === 'undefined') { res([]); return }
      chrome.storage.local.get([KEY], (r) => res(Array.isArray(r?.[KEY]) ? (r[KEY] as SavedDeck[]) : []))
    } catch { res([]) }
  })
}
function set(list: SavedDeck[]): Promise<void> {
  return new Promise((res) => {
    try {
      if (typeof chrome === 'undefined') { res(); return }
      chrome.storage.local.set({ [KEY]: list }, () => res())
    } catch { res() }
  })
}

export async function loadDecks(): Promise<SavedDeck[]> {
  return get()
}
export async function saveDeck(d: SavedDeck): Promise<SavedDeck[]> {
  const list = await get()
  const next = [d, ...list.filter((x) => x.id !== d.id)].slice(0, 50)
  await set(next)
  return next
}
export async function deleteDeck(id: string): Promise<SavedDeck[]> {
  const next = (await get()).filter((x) => x.id !== id)
  await set(next)
  return next
}
