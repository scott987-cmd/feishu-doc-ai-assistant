/**
 * URL guards for values that originate from untrusted sources (model output, table
 * cells, a remote template registry). Anything rendered as a link or image src must
 * pass through here so a `javascript:` / `data:` / `file:` URL can't be injected.
 */

/** Returns the trimmed URL if it's a plain http(s) URL, else null. */
export function safeHttpUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const v = url.trim()
  return /^https?:\/\//i.test(v) ? v : null
}

/** Image src guard — covers/images from remote/model data must be http(s) only. */
export const safeImageSrc = safeHttpUrl

/**
 * Open an http(s) URL in a new browser tab from an extension page (side panel).
 * A bare <a target="_blank"> click is unreliable inside a Chrome side panel — the panel
 * often swallows the navigation, so links look "dead". chrome.tabs.create reliably opens
 * a real tab (no "tabs" permission needed for a URL). Falls back to window.open (dev UI).
 * No-op for non-http(s) input (xss guard). Returns true if it attempted to open.
 */
export function openUrlInNewTab(url: unknown): boolean {
  const safe = safeHttpUrl(url)
  if (!safe) return false
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    chrome.tabs.create({ url: safe }).catch(() => window.open(safe, '_blank', 'noreferrer'))
  } else {
    window.open(safe, '_blank', 'noreferrer')
  }
  return true
}
