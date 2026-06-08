import type { ScenarioTemplate, RegistryIndex, RegistryEntry } from './types'
import { BUILTIN_TEMPLATES } from './builtin'
import { safeImageSrc } from '../url'

/**
 * Shape-validate + sanitize a template fetched from a remote registry before it can
 * drive table creation. Drops structurally-invalid entries (returns null) and strips
 * an unsafe cover URL (javascript:/data:) rather than letting it reach an <img src>.
 */
export function sanitizeRemoteTemplate(raw: unknown): ScenarioTemplate | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Record<string, unknown>
  if (typeof t.id !== 'string' || !t.id) return null
  if (typeof t.name !== 'string' || !t.name) return null
  if (!Array.isArray(t.tables)) return null // engine iterates tables; must be an array
  const cover = typeof t.cover === 'string' ? (safeImageSrc(t.cover) ?? undefined) : undefined
  return { ...(raw as ScenarioTemplate), cover, source: 'remote' as const }
}

const CACHE_KEY = 'template_registry_cache'
const CACHE_TTL = 60 * 60 * 1000  // 1 hour

interface CacheEntry {
  url: string
  index: RegistryIndex
  templates: ScenarioTemplate[]
  fetchedAt: number
}

/** Fetch and cache the remote registry. Returns remote templates on success. */
export async function fetchRemoteTemplates(registryUrl: string): Promise<{
  templates: ScenarioTemplate[]
  error?: string
  fromCache?: boolean
}> {
  const url = registryUrl.trim()
  if (!url) return { templates: [] }

  // Security: allow HTTPS or same-origin relative paths. http://localhost is permitted
  // ONLY in dev/test builds — a production extension must never fetch templates (which
  // drive table creation) from a local server an attacker could stand up. Reject all
  // other plain HTTP to prevent MITM injection of templates.
  const isRelative = url.startsWith('/')
  const isHttps = url.startsWith('https://')
  const isLocalHttp = !import.meta.env.PROD && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url)
  if (!isRelative && !isHttps && !isLocalHttp) {
    return { templates: [], error: '模板库地址必须用 HTTPS 或相对路径（http://localhost 仅限本地开发），已拒绝以防注入恶意模板' }
  }

  // Check cache
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) {
      const cached: CacheEntry = JSON.parse(raw)
      if (cached.url === url && Date.now() - cached.fetchedAt < CACHE_TTL) {
        return { templates: cached.templates, fromCache: true }
      }
    }
  } catch { /* ignore */ }

  try {
    // Two shapes supported from ONE accessible URL:
    //  • a direct .json file → a bundle ({templates:[full ScenarioTemplate]}) or an index
    //  • a directory base → fetch {base}/index.json
    const pointsAtFile = /\.json($|\?)/i.test(url)
    const indexUrl = pointsAtFile ? url : `${url.replace(/\/$/, '')}/index.json`
    const base = pointsAtFile ? url.replace(/\/[^/]*$/, '') : url.replace(/\/$/, '')

    const indexRes = await fetch(indexUrl, { cache: 'no-cache' })
    if (!indexRes.ok) throw new Error(`${indexUrl} ${indexRes.status} ${indexRes.statusText}`)
    const index: RegistryIndex = await indexRes.json()

    const entries = (index.templates ?? []) as unknown as Array<RegistryEntry | ScenarioTemplate>
    const templates = await Promise.all(
      entries.map((entry) => {
        // Bundle: the full template (with tables) is inlined — no extra request.
        if (Array.isArray((entry as ScenarioTemplate).tables)) {
          return Promise.resolve(sanitizeRemoteTemplate(entry))
        }
        // Index: each entry references a separate file to fetch.
        return fetchTemplateFile(base, entry as RegistryEntry)
      })
    )
    const valid = templates.filter((t): t is ScenarioTemplate => t !== null)

    // Cache write is BEST-EFFORT — a quota/serialize failure (remote bundles inline full tables +
    // sample rows and can exceed the ~5MB localStorage quota) must NOT discard the templates we
    // already fetched & sanitized, which is what the outer catch would do (returning zero).
    try {
      const entry: CacheEntry = { url, index, templates: valid, fetchedAt: Date.now() }
      localStorage.setItem(CACHE_KEY, JSON.stringify(entry))
    } catch { /* over quota / serialize error → skip cache, just re-fetch next time */ }

    return { templates: valid }
  } catch (err) {
    return { templates: [], error: err instanceof Error ? err.message : String(err) }
  }
}

async function fetchTemplateFile(base: string, entry: RegistryEntry): Promise<ScenarioTemplate | null> {
  try {
    // Never fetch a plain-http template file (it drives table creation) — only https
    // absolute URLs or paths relative to the (already https-validated) base.
    if (/^http:\/\//i.test(entry.file)) return null
    const url = entry.file.startsWith('https://') ? entry.file : `${base}/${entry.file}`
    const res = await fetch(url)
    if (!res.ok) return null
    return sanitizeRemoteTemplate(await res.json())
  } catch {
    return null
  }
}

export function clearRegistryCache() {
  localStorage.removeItem(CACHE_KEY)
}

export function getCacheInfo(): { url: string; fetchedAt: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const c: CacheEntry = JSON.parse(raw)
    return { url: c.url, fetchedAt: c.fetchedAt }
  } catch { return null }
}

/** Merge built-in and remote templates, remote overrides built-in by id */
export function mergeTemplates(remote: ScenarioTemplate[]): ScenarioTemplate[] {
  const map = new Map<string, ScenarioTemplate>()
  for (const t of BUILTIN_TEMPLATES) map.set(t.id, t)
  for (const t of remote) map.set(t.id, t)    // remote wins on id collision
  return [...map.values()]
}
