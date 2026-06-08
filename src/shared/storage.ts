/** Promisified chrome.storage.local get/set that swallow errors (used by the local caches). */
export function storageGet(key: string): Promise<unknown> {
  return new Promise((res) => { try { chrome.storage.local.get([key], (r) => res(r?.[key])) } catch { res(undefined) } })
}
export function storageSet(key: string, val: unknown): Promise<void> {
  return new Promise((res) => { try { chrome.storage.local.set({ [key]: val }, () => res()) } catch { res() } })
}
