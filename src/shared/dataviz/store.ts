import type { SavedViz } from './types'
import { scheduleBackup } from '../artifactSync'

// Saved visualizations live in chrome.storage.local (local-only, like recipes/sessions).
// On enterprise (proxy) builds they're ALSO mirrored to the company cloud for loss recovery —
// scheduleBackup is a total no-op otherwise, so the store/BYO build is unaffected.
const KEY = 'dataviz_v1'

function get(): Promise<SavedViz[]> {
  return new Promise((res) => {
    try {
      if (typeof chrome === 'undefined') { res([]); return }
      chrome.storage.local.get([KEY], (r) => res(Array.isArray(r?.[KEY]) ? (r[KEY] as SavedViz[]) : []))
    } catch { res([]) }
  })
}
function set(list: SavedViz[]): Promise<void> {
  return new Promise((res) => {
    try {
      if (typeof chrome === 'undefined') { res(); return }
      chrome.storage.local.set({ [KEY]: list }, () => res())
    } catch { res() }
  })
}

export async function loadVizList(): Promise<SavedViz[]> {
  return get()
}
/** Bulk overwrite — used by cloud restore (merge) to write the merged list back. */
export async function replaceVizList(list: SavedViz[]): Promise<void> {
  await set(list.slice(0, 50))
}
export async function saveViz(v: SavedViz): Promise<SavedViz[]> {
  const list = await get()
  const next = [v, ...list.filter((x) => x.id !== v.id)].slice(0, 50)
  await set(next)
  scheduleBackup('dataviz', next) // mirror to company cloud (no-op off proxy)
  return next
}
export async function deleteViz(id: string): Promise<SavedViz[]> {
  const next = (await get()).filter((x) => x.id !== id)
  await set(next)
  scheduleBackup('dataviz', next) // push the smaller mirror so a delete won't be resurrected on restore
  return next
}
