/**
 * CSP connect-src sources for the LLM endpoint (vite.config.ts → manifest `extension_pages`).
 *
 * Must admit exactly what the runtime guard admits (src/shared/providers.ts assertSafeBaseUrl):
 * unpinned → any https host; pinned (VITE_OPENAI_ALLOWED_HOSTS) → each host AND its subdomains,
 * on any port. A narrower CSP lets a Base URL pass the guard and then fail inside fetch() as an
 * opaque "Connection error." — e.g. pin `corp.example` + Base URL `https://llm.corp.example`, or
 * a gateway on :8443 (a CSP host-source without a port only matches 443).
 *
 * @param {string[]} pinnedHosts lower-cased hostnames; empty = not pinned
 * @returns {string[]}
 */
export function llmConnectSources(pinnedHosts) {
  if (!pinnedHosts.length) return ['https:']
  return pinnedHosts.flatMap((h) =>
    /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(h) && /[a-z]/.test(h)
      ? [`https://${h}:*`, `https://*.${h}:*`] // DNS name: itself + subdomains
      : [`https://${h}:*`]) // IP literal: there are no subdomains
}
