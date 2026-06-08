import type { SavedViz } from './types'

// Saved visualizations live in chrome.storage.local (local-only, like recipes/sessions).
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
export async function saveViz(v: SavedViz): Promise<SavedViz[]> {
  const list = await get()
  const next = [v, ...list.filter((x) => x.id !== v.id)].slice(0, 50)
  await set(next)
  return next
}
export async function deleteViz(id: string): Promise<SavedViz[]> {
  const next = (await get()).filter((x) => x.id !== id)
  await set(next)
  return next
}
