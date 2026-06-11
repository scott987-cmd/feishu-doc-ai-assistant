/**
 * Floating launchers: a Feishu page can have SEVERAL saved dashboards bound to its resource.
 * Each gets its own pill (stacked bottom-left). Click a pill → expand that dashboard (its own
 * overlay window); click again → collapse it. Multiple dashboards can be open at once.
 */
import { parseFeishuContext } from '../shared/feishu/pageUrl'
import { loadVizList } from '../shared/dataviz/store'
import { loadDecks, type SavedDeck } from '../shared/ai/slidesStore'
import { ctxDocKey, deckScopeKey, savedVizMatchesCtx } from '../shared/dataviz/scope'
import type { SavedViz } from '../shared/dataviz/types'
import { isVizOpen, closeViz } from './viz-overlay'

let host: HTMLDivElement | null = null // shadow host (page-fixed anchor)
let bar: HTMLDivElement | null = null  // flex row INSIDE the shadow root (holds the pills)
// Monotonic guard: refreshLauncher is fired from several uncoordinated, un-debounced sites (SPA
// nav, storage.onChanged, initial load). Without this, a fast A→B table switch can let A's slower
// storage read resolve AFTER B's and repaint A's pills while the user is on B.
let runSeq = 0


function ensureBar(): HTMLDivElement {
  // Rebuild if the host was orphaned — Feishu's SPA can replace document.body, detaching our host;
  // without this check ensureBar would keep returning the stale (invisible) bar and pills vanish.
  if (bar && host?.isConnected) return bar
  if (host) { try { host.remove() } catch { /* already detached */ } }
  // Render INSIDE a Shadow DOM: the Feishu page's global CSS can't reach in, so our flex row
  // can't be reset/overridden — without this, page styles stacked the pills on top of each other
  // instead of laying them out in a row.
  host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:20px;bottom:20px;z-index:2147483600;'
  const shadow = host.attachShadow({ mode: 'open' })
  bar = document.createElement('div')
  // Horizontal row along the BOTTOM edge, wrapping upward only when there are many pills.
  bar.style.cssText =
    'display:flex;flex-direction:row;flex-wrap:wrap;gap:8px;align-items:flex-end;max-width:calc(100vw - 40px);'
  shadow.appendChild(bar)
  document.body.appendChild(host)
  return bar
}
function clearBar() { if (host) { host.remove(); host = null; bar = null } }

const PILL_IDLE = '0.55'   // translucent at rest, so it barely obscures the document
const PILL_HOVER = '1'     // deepens to full color on hover

function makePill(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.style.cssText =
    'flex:0 0 auto;box-sizing:border-box;display:flex;align-items:center;gap:6px;max-width:240px;padding:9px 14px;border:none;border-radius:999px;' +
    'cursor:pointer;background:#4f6bff;color:#fff;box-shadow:0 6px 24px rgba(79,107,255,.4);' +
    "font:13px/1.2 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;white-space:nowrap;" +
    'overflow:hidden;text-overflow:ellipsis;opacity:' + PILL_IDLE + ';transition:opacity .18s ease, box-shadow .18s ease;'
  b.textContent = label
  b.title = title
  // Dynamic transparency: faded while idle (doesn't block content), color deepens on hover.
  b.onmouseenter = () => { b.style.opacity = PILL_HOVER }
  b.onmouseleave = () => { b.style.opacity = PILL_IDLE }
  b.onclick = onClick
  return b
}

function pill(v: SavedViz): HTMLButtonElement {
  return makePill((v.kind === 'site' ? '🌐 ' : '📊 ') + v.name, '点击展开/收起「' + v.name + '」', () => {
    if (isVizOpen(v.id)) closeViz(v.id) // collapse
    else { try { chrome.runtime.sendMessage({ type: 'DATAVIZ_OPEN_SAVED', vizId: v.id }) } catch { /* */ } }
  })
}

function deckPill(d: SavedDeck): HTMLButtonElement {
  return makePill('🎞️ ' + d.name, '点击展开/收起「' + d.name + '」演示', () => {
    if (isVizOpen(d.id)) closeViz(d.id) // collapse
    else { try { chrome.runtime.sendMessage({ type: 'DATAVIZ_OPEN_DECK', deckId: d.id }) } catch { /* */ } }
  })
}

type Ctx = ReturnType<typeof parseFeishuContext>
// A Base/Sheet opened via 知识库(Wiki) has a wiki URL the content script can't resolve (no token),
// so ctxDocKey would be null and NO saved-site pills would ever show. Resolve via the background
// (cached per wiki token) so the launcher can match the underlying Base/Sheet.
const wikiResolveCache = new Map<string, NonNullable<Ctx>>()
async function resolvePage(): Promise<Ctx> {
  const f = parseFeishuContext(location.href)
  if (f?.kind !== 'wiki' || !f.wikiToken) return f
  const cached = wikiResolveCache.get(f.wikiToken)
  if (cached) return cached
  try {
    const r = await chrome.runtime.sendMessage({ type: 'RESOLVE_PAGE_RESOURCE', wikiToken: f.wikiToken })
    if (r) { wikiResolveCache.set(f.wikiToken, r as NonNullable<Ctx>); return r as Ctx }
  } catch { /* background unavailable → stay wiki, retry next refresh */ }
  return f
}

/** Re-evaluate which launcher pills to show for the current page resource. */
export async function refreshLauncher() {
  const myRun = ++runSeq
  const f = await resolvePage()
  // Per data-table (vizMatchesCtx); ctxDocKey just gates "on a Base/Sheet page at all". A MULTI-
  // table site spans the whole doc, so show its pill on ANY table of that Base — not just the one
  // table it was generated from (otherwise a multi-table 建站 vanishes the moment you switch table).
  const matches = ctxDocKey(f)
    ? (await loadVizList()).filter((v) => savedVizMatchesCtx(v, f))
    : []
  // Saved PPT decks live in a SEPARATE store — surface them as pills too, so图表/看板/网站/PPT
  // all get a one-click launcher on the page (not "open the matching extension tab"). Decks are
  // scoped by srcKey (= ctxScopeKey), matching how SlidesPanel filters its list.
  const deckKey = deckScopeKey(f)
  const decks = deckKey ? (await loadDecks()).filter((d) => d.srcKey === deckKey) : []
  if (myRun !== runSeq) return // a newer refresh started during the await — let it win (guards clearBar too)
  if (!matches.length && !decks.length) { clearBar(); return }
  const c = ensureBar()
  c.innerHTML = ''
  for (const v of matches) c.appendChild(pill(v))
  for (const d of decks) c.appendChild(deckPill(d))
}

// Saving/deleting a viz OR a slides deck updates storage → refresh pills without a page reload.
try {
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === 'local' && (changes.dataviz_v1 || changes.slides_decks_v1)) void refreshLauncher()
  })
} catch { /* no storage here */ }
