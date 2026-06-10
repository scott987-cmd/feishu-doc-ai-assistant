import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSettings, PageContext } from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/types'
import { mergeResolvedWiki } from './wikiResolve'

/** Map a resolved wiki node's obj_type to a PageContext.feishu resource. */
function wikiToFeishu(objType: string, objToken: string): PageContext['feishu'] | undefined {
  if (objType === 'bitable') return { isBase: true, kind: 'base', appToken: objToken }
  if (objType === 'sheet') return { isBase: false, kind: 'sheet', spreadsheetToken: objToken }
  if (objType === 'docx' || objType === 'doc') return { isBase: false, kind: 'doc', documentId: objToken }
  return undefined
}
import { isFeishuConfigured, resolveToken, isTokenExpiredError, forceRefreshUserToken } from '../shared/feishu/auth'
import * as API from '../shared/feishu/api'
import { getDocumentMeta } from '../shared/feishu/docx'
import { encryptField, decryptField } from '../shared/crypto'
import { checkNetworkAccess } from '../shared/network'
import { BUILD_CONFIG, HAS_NETWORK_RESTRICTION, HAS_BUILTIN_CREDS, CLIP_ENABLED, HAS_ENTERPRISE_POLICY } from '../shared/config'
import { usingManagedLlm } from '../shared/ai/llmConfig'
import { fetchPolicy, loadPolicy, applyPolicy, FAILCLOSED_POLICY } from '../shared/enterprisePolicy'
import { deriveAccent, DEFAULT_ACCENT, ACCENT_VAR_NAMES } from '../shared/theme'
import { parseFeishuContext, cleanDocTitle } from '../shared/feishu/pageUrl'
import type { ClipCapture } from '../shared/clip/types'
import { fileToClip } from '../shared/clip/file'
import ChatPanel from './components/ChatPanel'
import ClipPanel from './components/ClipPanel'
import Settings from './components/Settings'
import NetworkBlocked from './components/NetworkBlocked'
import ScenarioPanel from './components/ScenarioPanel'
import DemoPanel from './components/DemoPanel'
import UndoBar from './components/UndoBar'
import SessionDrawer from './components/SessionDrawer'
import { useSessions } from './sessions/useSessions'
import './App.css'

type Tab = 'chat' | 'scenes' | 'clip'

type NetworkState = 'checking' | 'allowed' | 'blocked'

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [showSettings, setShowSettings] = useState(false)
  const [showDemo, setShowDemo] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return localStorage.getItem('fa-theme') === 'dark' ? 'dark' : 'light' } catch { return 'light' }
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.rev = '9f4b7e2a'
    try { localStorage.setItem('fa-theme', theme) } catch { /* ignore */ }
  }, [theme])
  const [accent, setAccent] = useState<string>(() => {
    try { return localStorage.getItem('fa-accent') || DEFAULT_ACCENT } catch { return DEFAULT_ACCENT }
  })
  useEffect(() => {
    const root = document.documentElement
    if (accent === DEFAULT_ACCENT) {
      // Use the hand-tuned CSS defaults — clear any runtime overrides.
      for (const name of ACCENT_VAR_NAMES) root.style.removeProperty(name)
    } else {
      const vars = deriveAccent(accent, theme === 'dark')
      for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value)
    }
    try { localStorage.setItem('fa-accent', accent) } catch { /* ignore */ }
  }, [accent, theme])
  const [ctx, setCtx] = useState<PageContext>({ url: '', title: '', selectedText: '' })
  const [tab, setTab] = useState<Tab>('chat')
  // Read the live tab inside the auto-switch effect WITHOUT re-triggering it (no dep) — so the
  // effect can respect that the user is currently on 场景 and not yank them back to 对话.
  const tabRef = useRef(tab); tabRef.current = tab
  // Web Clipper: a capture (or a capture error) pushed from the background → opens the
  // clip view. Null clip + null error = no active clip.
  const [clip, setClip] = useState<ClipCapture | null>(null)
  const [clipError, setClipError] = useState<string | null>(null)
  // Drag-to-import: a file dropped on the panel is parsed locally into the same clip flow.
  const [dragging, setDragging] = useState(false)

  function onFileDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    fileToClip(file)
      .then((c) => { setClipError(null); setClip(c); setTab('clip') })
      .catch((err) => { setClip(null); setClipError(err instanceof Error ? err.message : String(err)); setTab('clip') })
  }
  function onDragOver(e: React.DragEvent) {
    if (!CLIP_ENABLED) return
    if (Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); setDragging(true) }
  }
  const [chatStreaming, setChatStreaming] = useState(false)
  // A template build is in-flight in ScenarioPanel — freeze nav that would unmount it mid-build
  // (always cleared because runTemplate always settles, even if the panel unmounted meanwhile).
  const [scenarioBusy, setScenarioBusy] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Bind the session to whichever Feishu resource is open (Base / Sheet / Doc). A wiki
  // node counts as its own resource until it resolves, so switching to a wiki doc doesn't
  // momentarily fall back to the general session.
  // Prefer wikiToken when present so a wiki-opened resource keeps ONE stable session key
  // across resolution — wiki→doc/base no longer flips the key and abandons the conversation
  // in a new empty session (the "会话没有了" after switching back).
  const rawResource =
    ctx.feishu?.wikiToken ?? ctx.feishu?.appToken ?? ctx.feishu?.spreadsheetToken ?? ctx.feishu?.documentId ?? null
  // Debounce it: a tab switch / wiki resolution / panel remount briefly churns the context
  // (often through a transient null), which otherwise flips the conversation to the general
  // session and back — looking "scrambled". Settle first, then switch sessions once.
  const [activeResource, setActiveResource] = useState<string | null>(rawResource)
  useEffect(() => {
    const t = setTimeout(() => setActiveResource(rawResource), 250)
    return () => clearTimeout(t)
  }, [rawResource])
  const sessions = useSessions(activeResource, chatStreaming)
  const [network, setNetwork] = useState<NetworkState>(HAS_NETWORK_RESTRICTION ? 'checking' : 'allowed')
  const [blockedIPs, setBlockedIPs] = useState<string[]>([])

  // Resolve a wiki node to its real resource (doc / sheet / base). Cached per token.
  // Needs the app's wiki scope; without it the page stays a generic "知识库".
  const wikiCacheRef = useRef<Map<string, NonNullable<PageContext['feishu']>>>(new Map())
  // Real titles of direct /docx/ pages, fetched via API (the SPA's document.title is unreliable
  // on some private/on-prem deploys — it can even be the raw URL). Cached per documentId.
  const docTitleCacheRef = useRef<Map<string, string>>(new Map())
  // True when a Feishu call failed because the user session is expired AND can't be refreshed
  // (the refresh_token is dead → needs manual re-auth). Drives the "登录已失效" banner so the
  // user isn't left staring at a misleading "正在解析知识库…" / "请先打开表格" hint.
  const [authExpired, setAuthExpired] = useState(false)
  // Re-authorizing (new token saved) clears the expired state.
  useEffect(() => { setAuthExpired(false) }, [settings.feishuAccessToken])

  // Set context, but if it's an already-resolved wiki, substitute the cached real
  // resource — so refreshCtx (tab events) doesn't keep flipping wiki↔doc, which
  // would thrash the bound session and mix conversations up.
  const applyCtx = useCallback((next: PageContext) => {
    let feishu = next.feishu
    if (feishu?.kind === 'wiki' && feishu.wikiToken) {
      const cached = wikiCacheRef.current.get(feishu.wikiToken)
      if (cached) feishu = cached
    }
    setCtx({ ...next, feishu })
  }, [])

  const wikiToken = ctx.feishu?.kind === 'wiki' ? ctx.feishu.wikiToken : undefined
  useEffect(() => {
    if (!wikiToken) return
    const cached = wikiCacheRef.current.get(wikiToken)
    if (cached) { setCtx((c) => ({ ...c, feishu: cached })); return }
    let cancelled = false
    void (async () => {
      // Resolve the wiki node with a given token; throws on a Feishu error (expiry/scope/…).
      const resolveWith = async (token: string): Promise<void> => {
        const res = (await API.getWikiNode(token, wikiToken)) as {
          node?: { obj_type: string; obj_token: string; title?: string }
        }
        const n = res.node
        if (!n || cancelled) return
        const resolved = wikiToFeishu(n.obj_type, n.obj_token)
        if (!resolved) {
          // Unsupported wiki obj (mindnote / file / …) — drop to the general homepage.
          wikiCacheRef.current.set(wikiToken, { isBase: false })
          // Stale-guard: only apply if still on this wiki node (user may have moved on).
          setCtx((c) => mergeResolvedWiki(c, wikiToken, undefined))
          return
        }
        // Keep wikiToken on the resolved resource → the session key stays the stable wikiToken.
        const withWiki = { ...resolved, wikiToken }
        wikiCacheRef.current.set(wikiToken, withWiki)
        setCtx((c) => mergeResolvedWiki(c, wikiToken, withWiki, n.title))
      }
      try {
        await resolveWith(await resolveToken(settings))
        if (!cancelled) setAuthExpired(false)
      } catch (e) {
        // Expired session is the common cause of a "stuck on 知识库" page. Try a forced refresh
        // once; if the refresh_token is also dead, raise the "登录已失效" banner instead of
        // silently leaving it unresolved (which read as a misleading "请先打开表格").
        if (isTokenExpiredError(e)) {
          const fresh = await forceRefreshUserToken().catch(() => null)
          if (fresh) {
            try { await resolveWith(fresh); if (!cancelled) setAuthExpired(false); return } catch { /* still bad → expired */ }
          }
          if (!cancelled) setAuthExpired(true)
        }
        // Other errors (e.g. missing wiki scope) → leave as 知识库, unresolved (prior behavior).
      }
    })()
    return () => { cancelled = true }
  }, [wikiToken, settings])

  // Direct /docx/ pages (no wiki): fetch the REAL doc title via API and use it as the name —
  // mirrors how Base pages resolve appName. Without this, the doc name falls back to the SPA's
  // document.title, which on some private/on-prem deploys is the raw URL (the "name = full URL"
  // bug). Wiki-resolved docs already get their title from getWikiNode, so skip those.
  const docId = ctx.feishu?.kind === 'doc' && !ctx.feishu.wikiToken ? ctx.feishu.documentId : undefined
  useEffect(() => {
    if (!docId) return
    const cached = docTitleCacheRef.current.get(docId)
    const applyTitle = (t: string) => setCtx((c) =>
      c.feishu?.kind === 'doc' && c.feishu.documentId === docId ? { ...c, title: t } : c)
    if (cached) { applyTitle(cached); return }
    let cancelled = false
    void (async () => {
      try {
        const meta = await getDocumentMeta(await resolveToken(settings), docId)
        const t = meta?.document?.title?.trim()
        if (t && !cancelled) { docTitleCacheRef.current.set(docId, t); applyTitle(t) }
      } catch { /* keep document.title fallback */ }
    })()
    return () => { cancelled = true }
  }, [docId, settings])

  // Default the view by page type: a supported Feishu resource opens to 对话, an
  // unsupported page opens to 首页 (scenes). This only sets the DEFAULT for a fresh
  // session — it must never yank the user out of an active conversation (e.g. after the
  // agent creates a new doc, page context can flip but the chat must stay).
  const pageSupported = !!ctx.feishu?.kind
  const hasConversation = sessions.messages.length > 0
  useEffect(() => {
    if (clip || clipError) return        // a clip is open — never yank away from it
    if (chatStreaming) return            // don't switch mid-turn (would unmount ChatPanel)
    if (scenarioBusy) return             // don't switch mid-build (would lose the progress screen)
    if (tabRef.current === 'scenes') return // user is in 场景 (e.g. AI建站) — don't pull them to 对话
    if (hasConversation) return          // keep the user in their active conversation
    setTab(pageSupported ? 'chat' : 'scenes')
  }, [pageSupported, chatStreaming, scenarioBusy, hasConversation, clip, clipError])

  // Name Sheet/Doc sessions from the page title — once the session is ready, so it
  // doesn't fire before the session exists (Base sessions name from appName instead).
  const { ready: sessionsReady, resolveTitle } = sessions
  const activeSessionId = sessions.activeSession?.id
  useEffect(() => {
    const fz = ctx.feishu
    const token = fz?.wikiToken ?? fz?.spreadsheetToken ?? fz?.documentId
    if (!token || !ctx.title || !sessionsReady) return
    const name = cleanDocTitle(ctx.title)
    if (name) resolveTitle(token, name)
  }, [ctx.feishu, ctx.title, sessionsReady, activeSessionId, resolveTitle])

  useEffect(() => {
    // ── Network check ────────────────────────────────────────────────────────
    if (HAS_NETWORK_RESTRICTION) {
      checkNetworkAccess(BUILD_CONFIG.allowedCidrs).then((result) => {
        setBlockedIPs(result.localIPs)
        setNetwork(result.allowed ? 'allowed' : 'blocked')
      })
    }

    // ── Load settings (decrypt sensitive fields) ──────────────────────────
    chrome.storage.local.get(['settings_v2'], async (r) => {
      const stored = r.settings_v2 as Record<string, string> | undefined
      if (!stored) return
      const token = await decryptField(stored.feishuAccessToken ?? '')
      const apiKey = await decryptField(stored.openaiApiKey ?? '')
      const loaded: AppSettings = {
        ...DEFAULT_SETTINGS,
        openaiBaseUrl: stored.openaiBaseUrl ?? DEFAULT_SETTINGS.openaiBaseUrl,
        openaiModel: stored.openaiModel ?? DEFAULT_SETTINGS.openaiModel,
        openaiApiKey: apiKey,
        feishuAccessToken: token,
        feishuOwnerOpenId: stored.feishuOwnerOpenId ?? '',
        templateRegistryUrl: stored.templateRegistryUrl ?? '',
        learnFromHistory: (stored.learnFromHistory as unknown as boolean | undefined) !== false,
        voiceInput: (stored.voiceInput as unknown as boolean | undefined) !== false,
        autoConfirm: (stored.autoConfirm as unknown as boolean | undefined) === true,
        llmSource: (stored.llmSource as AppSettings['llmSource']) ?? undefined,
      }
      // Enterprise central policy (applied over the just-loaded base). FAIL-CLOSED: on a policy build,
      // until the real policy is known (no cache / proxy down) we force the conservative default
      // (no auto-confirm of deletes) — a proxy outage must never loosen the enterprise's controls.
      const eff = (p: Awaited<ReturnType<typeof loadPolicy>>) =>
        applyPolicy(loaded, p ?? (HAS_ENTERPRISE_POLICY ? FAILCLOSED_POLICY : null))
      setSettings(eff(await loadPolicy()))
      void fetchPolicy(loaded).then((fresh) => setSettings(eff(fresh)))
    })

    // ── Tab/context listeners (named so they can be cleaned up — avoids duplicate
    //    registration under React 18 StrictMode's double-invoke in dev). ─────────────
    refreshCtx()
    const onMsg = (
      msg: { type?: string; payload?: unknown; message?: string },
      sender: chrome.runtime.MessageSender,
    ) => {
      if (sender.id !== chrome.runtime.id) return
      // Web Clipper pushes (from the background, for an already-open panel).
      if (msg.type === 'CLIP_CAPTURE') { setClipError(null); setClip(msg.payload as ClipCapture); setTab('clip'); return }
      if (msg.type === 'CLIP_ERROR') { setClip(null); setClipError(msg.message ?? '剪藏失败'); setTab('clip'); return }
      // Trust context updates only from our own content scripts, and ignore pushes from a
      // CONFIRMED-inactive (background) tab — those would scramble the conversation when
      // multiple Feishu tabs are open. The active tab (incl. its field-selection pushes)
      // still gets through. (We don't gate on windowId — chrome.windows.getCurrent() is
      // unreliable in a side panel and was wrongly dropping legit pushes.)
      if (msg.type !== 'PAGE_CONTEXT_UPDATE') return
      if (sender.tab?.active === false) return
      applyCtx(msg.payload as PageContext)
    }
    // Follow tab switches (use the EXACT activated tab id — no ambiguous window query),
    // SPA navigation (info.url), and WINDOW switches (onFocusChanged).
    const onActivated = (info: chrome.tabs.TabActiveInfo) => void refreshCtx(info.tabId)
    const onUpdated = (id: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (tab.active && (info.status === 'complete' || info.url)) void refreshCtx(id)
    }
    const onFocus = (windowId: number) => { if (windowId !== chrome.windows.WINDOW_ID_NONE) void refreshCtx() }
    chrome.runtime.onMessage.addListener(onMsg)
    chrome.tabs.onActivated.addListener(onActivated)
    chrome.tabs.onUpdated.addListener(onUpdated)
    chrome.windows?.onFocusChanged?.addListener(onFocus)

    // A clip opens the panel async, so the CLIP_CAPTURE push above can arrive before this
    // listener exists. Pull any pending clip the background stashed (one-shot, recent only).
    if (CLIP_ENABLED) {
      chrome.runtime.sendMessage({ type: 'CLIP_REQUEST' }).then((resp) => {
        const r = resp as { payload?: ClipCapture; error?: string; at?: number } | null
        // Short window: only covers the genuine open→mount race (sub-second). 30s let an
        // already-handled clip (delivered live via the CLIP_CAPTURE push) re-open on a panel
        // remount within the window — a stale replay of a clip the user already dealt with.
        if (!r || (r.at && Date.now() - r.at > 5_000)) return
        if (r.payload) { setClipError(null); setClip(r.payload); setTab('clip') }
        else if (r.error) { setClip(null); setClipError(r.error); setTab('clip') }
      }).catch(() => { /* no background / no pending clip */ })
    }

    return () => {
      chrome.runtime.onMessage.removeListener(onMsg)
      chrome.tabs.onActivated.removeListener(onActivated)
      chrome.tabs.onUpdated.removeListener(onUpdated)
      chrome.windows?.onFocusChanged?.removeListener(onFocus)
    }
  }, [])

  async function refreshCtx(tabId?: number) {
    try {
      // Prefer the EXACT tab from the event (onActivated/onUpdated). `currentWindow` is
      // unreliable from a side panel — it can resolve to the wrong window, so a tab switch
      // would read the wrong page and the panel wouldn't follow (and the session would thrash).
      let tab: chrome.tabs.Tab | undefined
      if (tabId != null) tab = await chrome.tabs.get(tabId).catch(() => undefined)
      if (!tab) { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); tab = t }
      if (!tab?.id) return
      try {
        // Preferred: ask the content script (also gives selectedText).
        const resp = (await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTEXT' })) as PageContext | undefined
        if (resp) {
          // A stale content script (old build, page not refreshed) may not detect
          // Sheets/Docs. Always (re)derive the resource from the URL so detection
          // doesn't depend on the content script version.
          const url = resp.url || tab.url || ''
          applyCtx({ ...resp, feishu: resp.feishu ?? parseFeishuContext(url) })
          return
        }
      } catch {
        // Content script not injected yet — fall back to parsing the tab URL.
      }
      const url = tab.url ?? ''
      applyCtx({ url, title: tab.title ?? '', selectedText: '', feishu: parseFeishuContext(url) })
    } catch { /* tab without access */ }
  }

  async function saveSettings(s: AppSettings) {
    // Encrypt sensitive fields before persisting
    const [encToken, encApiKey] = await Promise.all([
      encryptField(s.feishuAccessToken),
      encryptField(s.openaiApiKey),
    ])
    chrome.storage.local.set({
      settings_v2: {
        openaiBaseUrl: s.openaiBaseUrl,
        openaiModel: s.openaiModel,
        openaiApiKey: encApiKey,
        feishuAccessToken: encToken,
        // Not sensitive — persist as-is (these were silently dropped before).
        feishuOwnerOpenId: s.feishuOwnerOpenId,
        templateRegistryUrl: s.templateRegistryUrl,
        learnFromHistory: s.learnFromHistory !== false,
        voiceInput: s.voiceInput !== false,
        autoConfirm: s.autoConfirm === true,
        llmSource: s.llmSource, // managed/manual choice must persist (was dropped → switch never stuck)
      },
    })
    setSettings(s)
    setShowSettings(false)
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (network === 'checking') {
    return (
      <div className="app">
        <div className="app-splash">
          <div className="splash-spinner" />
          <span>检查网络访问权限…</span>
        </div>
      </div>
    )
  }

  if (network === 'blocked') {
    return (
      <div className="app">
        <NetworkBlocked localIPs={blockedIPs} />
      </div>
    )
  }

  // In enterprise managed-LLM mode the key comes from the proxy after Feishu auth (no per-user
  // openaiApiKey); else the user must have entered their own. Both still need Feishu configured.
  const llmReady = usingManagedLlm(settings) ? isFeishuConfigured(settings) : !!settings.openaiApiKey
  const configured = llmReady && isFeishuConfigured(settings)

  // The assistant only operates on Feishu pages. On any other site we show nothing but a
  // hint (and keep the header so Settings stays reachable). null = URL not known yet.
  const onFeishuPage: boolean | null = (() => {
    if (!ctx.url) return null
    try {
      const host = new URL(ctx.url).hostname.toLowerCase()
      const d = BUILD_CONFIG.feishuBaseDomain
      return host === d || host.endsWith('.' + d)
    } catch {
      return false
    }
  })()

  // New Bases are created with the app (tenant) identity → app-owned, so an open_id
  // is required to transfer them to the user before allowing create/operate.
  const needsOwner = HAS_BUILTIN_CREDS
  const ownerConfigured = !!settings.feishuOwnerOpenId?.trim()
  const canOperate = configured && (ownerConfigured || !needsOwner)

  return (
    <div
      className="app"
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false) }}
      onDrop={onFileDrop}
    >
      {dragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-card">
            <div className="drop-overlay-icon">📂</div>
            <div>松手导入文件</div>
            <div className="drop-overlay-sub">支持 CSV / TSV / 文本 → AI 整理写入飞书</div>
          </div>
        </div>
      )}
      <header className="app-header">
        <div className="header-brand">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <defs>
              <linearGradient id="brandGrad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
                <stop stopColor="#5b7cff"/>
                <stop offset="1" stopColor="#8b5cff"/>
              </linearGradient>
            </defs>
            <rect width="24" height="24" rx="7" fill="url(#brandGrad)"/>
            <path d="M12 5l1.5 3.9L17.5 10l-4 1.5L12 15l-1.5-3.5L6.5 10l4-1.1z" fill="#fff"/>
          </svg>
          <span className="brand-name">飞书文档AI助手</span>
        </div>
        <div className="header-actions">
          {ctx.feishu?.kind && (
            <span className="badge-base" title={ctx.url}>
              {ctx.feishu.kind === 'base' ? 'Base'
                : ctx.feishu.kind === 'sheet' ? '电子表格'
                : ctx.feishu.kind === 'wiki' ? '知识库…'
                : '文档'} ●
            </span>
          )}
          <button className="btn-icon" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} title="切换主题">
            {theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>
              </svg>
            )}
          </button>
          <button className="btn-icon" onClick={() => setShowSettings((v) => !v)} title="Settings" disabled={scenarioBusy}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>
      </header>

      {!configured && !showSettings && (
        <button className="setup-banner" onClick={() => setShowSettings(true)}>
          <span>⚠</span>
          <span>Configure API keys to get started</span>
          <span>→</span>
        </button>
      )}

      {configured && needsOwner && !ownerConfigured && !showSettings && (
        <button className="setup-banner" onClick={() => setShowSettings(true)}>
          <span>🔒</span>
          <span>请先用飞书账号授权（获取 open_id），否则无法新建/操作内容</span>
          <span>→</span>
        </button>
      )}

      {authExpired && !showSettings && (
        <button className="setup-banner" onClick={() => setShowSettings(true)}>
          <span>🔑</span>
          <span>飞书登录已失效，请重新登录后再使用</span>
          <span>→</span>
        </button>
      )}

      {!showSettings && <UndoBar settings={settings} />}

      <main className="app-main">
        <div className="app-view view-enter" key={showSettings ? 'settings' : tab}>
          {showSettings ? (
            <Settings
              settings={settings}
              accent={accent}
              onAccentChange={setAccent}
              onSave={saveSettings}
              onCancel={() => setShowSettings(false)}
            />
          ) : showDemo ? (
            <DemoPanel settings={settings} onBack={() => setShowDemo(false)} />
          ) : tab === 'clip' ? (
            <ClipPanel
              settings={settings}
              clip={clip}
              error={clipError ?? undefined}
              disabled={!canOperate}
              onClose={() => { setClip(null); setClipError(null); setTab(pageSupported ? 'chat' : 'scenes') }}
            />
          ) : onFeishuPage === false && !chatStreaming && !hasConversation ? (
            <div className="not-feishu">
              <div className="not-feishu-icon">📋</div>
              <div className="not-feishu-title">请在飞书页面使用</div>
              <div className="not-feishu-sub">
                打开飞书多维表格 / 文档 / 电子表格，本助手会自动识别并协助你。
                <br />当前不是飞书页面，已暂停显示。
                {CLIP_ENABLED && <><br /><br />💡 也可以把 <b>CSV / 表格文件</b>拖进来,AI 整理后写入飞书。</>}
              </div>
              <button className="not-feishu-demo" onClick={() => setShowDemo(true)} style={{ marginTop: 16 }}>
                🎬 体验示例（无需飞书登录）
              </button>
            </div>
          ) : tab === 'chat' ? (
            <ChatPanel
              settings={settings}
              context={ctx}
              disabled={!canOperate}
              messages={sessions.messages}
              setMessages={sessions.setMessages}
              setMessagesFor={sessions.setMessagesFor}
              activeSessionId={sessions.activeSession?.id}
              onStreamingChange={setChatStreaming}
              onBaseName={sessions.resolveTitle}
              sessionTitle={sessions.activeSession?.title}
              onOpenSessions={() => setDrawerOpen(true)}
            />
          ) : (
            <ScenarioPanel settings={settings} context={ctx} disabled={!canOperate} onBusyChange={setScenarioBusy} />
          )}
        </div>
      </main>

      {drawerOpen && (
        <SessionDrawer sessions={sessions} busy={chatStreaming} onClose={() => setDrawerOpen(false)} />
      )}

      {!showSettings && onFeishuPage !== false && (
        <nav className="app-tabs">
          <button
            className={`app-tab ${tab === 'chat' ? 'app-tab--active' : ''}`}
            onClick={() => setTab('chat')}
            disabled={scenarioBusy}
            title={scenarioBusy ? '正在创建，请稍候…' : undefined}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <span>对话</span>
          </button>
          <button
            className={`app-tab ${tab === 'scenes' ? 'app-tab--active' : ''}`}
            onClick={() => setTab('scenes')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
            </svg>
            <span>场景</span>
          </button>
        </nav>
      )}
    </div>
  )
}
