import type { Slide } from './slides'
import type { VizSource } from '../dataviz/types'
import { scheduleBackup } from '../artifactSync'

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
/** Bulk overwrite — used by cloud restore (merge) to write the merged list back. */
export async function replaceDecks(list: SavedDeck[]): Promise<void> {
  await set(list.slice(0, 50))
}
export async function saveDeck(d: SavedDeck): Promise<SavedDeck[]> {
  const list = await get()
  const next = [d, ...list.filter((x) => x.id !== d.id)].slice(0, 50)
  await set(next)
  scheduleBackup('slides', next) // mirror to company cloud (no-op off proxy)
  return next
}
export async function deleteDeck(id: string): Promise<SavedDeck[]> {
  const next = (await get()).filter((x) => x.id !== id)
  await set(next)
  scheduleBackup('slides', next) // push the smaller mirror so a delete won't be resurrected on restore
  return next
}
