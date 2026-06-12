import { useEffect, useRef, useState } from 'react'
import type { AppSettings, ChatMessage, PageContext } from '../../shared/types'
import type { BaseCtx } from '../../shared/feishu/context'
import { fetchBaseCtx } from '../../shared/feishu/context'
import { resolveToken } from '../../shared/feishu/auth'
import { WEB_SPEECH_ALLOWED } from '../../shared/config'
import { runAgent } from '../../shared/ai/agent'
import type { ConfirmRequest, ConfirmChoice, AskUserRequest } from '../../shared/ai/agent'
import { fetchVizData } from '../../shared/dataviz/data'
import { sendVizToActiveTab } from '../../shared/dataviz/send'
import type { VizSource } from '../../shared/dataviz/types'
import MessageList from './MessageList'
import UndoBar from './UndoBar'
import InputBar from './InputBar'
import type { InputBarHandle } from './InputBar'
import BaseContextBadge from './BaseContextBadge'
import ConfirmDialog from './ConfirmDialog'
import ChoiceDialog from './ChoiceDialog'
import './ChatPanel.css'

interface Props {
  settings: AppSettings
  context: PageContext
  disabled: boolean
  /** Active session's messages + setter (lifted to App for persistence/switching). */
  messages: ChatMessage[]
  setMessages: (u: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void
  /** Write to a specific session — used to bind a streaming reply to the session it began in. */
  setMessagesFor: (sessionId: string, u: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void
  activeSessionId?: string
  /** Report streaming state up (App defers session auto-switch while streaming). */
  onStreamingChange?: (streaming: boolean) => void
  /** Backfill the document session title once the Base name is known. */
  onBaseName?: (appToken: string, name: string) => void
  /** Current session title + opener for the session drawer. */
  sessionTitle?: string
  onOpenSessions?: () => void
}

export default function ChatPanel({
  settings, context, disabled,
  messages, setMessages, setMessagesFor, activeSessionId,
  onStreamingChange, onBaseName, sessionTitle, onOpenSessions,
}: Props) {
  const [streaming, setStreaming] = useState(false)
  useEffect(() => { onStreamingChange?.(streaming) }, [streaming, onStreamingChange])

  // Cancels the in-flight turn only when a NEW send supersedes it. We deliberately do
  // NOT abort on unmount: the agent writes to App-level session state (setMessagesFor),
  // so a view switch (tab change / non-Feishu placeholder) that unmounts this panel must
  // NOT kill a running turn — doing so silently stranded the agent mid-task (e.g. after
  // an ask_user/confirm dialog). The browser tears down the fetch when the panel closes.
  const abortRef = useRef<AbortController | null>(null)

  // Interactive confirmation (e.g. before creating a new Base). The agent loop
  // awaits the promise; the dialog buttons resolve it.
  const [pendingConfirm, setPendingConfirm] = useState<
    { req: ConfirmRequest; resolve: (c: ConfirmChoice) => void } | null
  >(null)

  function requestConfirmation(req: ConfirmRequest): Promise<ConfirmChoice> {
    return new Promise((resolve) => setPendingConfirm({ req, resolve }))
  }

  // Agent-driven choice card (ask_user tool). resolve(null) = dismissed.
  const [pendingAsk, setPendingAsk] = useState<
    { req: AskUserRequest; resolve: (label: string | null) => void } | null
  >(null)

  function askUser(req: AskUserRequest): Promise<string | null> {
    return new Promise((resolve) => setPendingAsk({ req, resolve }))
  }

  const inputRef = useRef<InputBarHandle>(null)

  // Base context (loaded when on a Feishu Base page)
  const [baseCtx, setBaseCtx] = useState<BaseCtx | null>(null)
  const [ctxLoading, setCtxLoading] = useState(false)
  const [ctxError, setCtxError] = useState('')
  const lastLoadedApp = useRef<string>('')
  // Latest Base whose context load was REQUESTED — fetchBaseCtx is multi-request and un-aborted,
  // so on a fast A→B switch A can resolve last and clobber B; commits below skip unless still latest.
  const latestReqApp = useRef<string>('')
  // Always-current context + loadBaseCtx for the debounced structural-refresh (replaces a stale
  // window-global timer whose callback closed over the Base that was active when it was scheduled).
  const contextRef = useRef(context); contextRef.current = context
  const loadBaseCtxRef = useRef<() => void>(() => {})
  const ctxRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (ctxRefreshTimer.current) clearTimeout(ctxRefreshTimer.current) }, [])

  // Auto-load Base context when URL changes to a Base page
  useEffect(() => {
    const appToken = context.feishu?.appToken
    if (!appToken || !context.feishu?.isBase) {
      setBaseCtx(null)
      return
    }
    // Avoid re-fetching when only view/table changes within same app
    if (appToken === lastLoadedApp.current && baseCtx) return
    loadBaseCtx()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.feishu?.appToken, context.feishu?.isBase])

  async function loadBaseCtx() {
    const appToken = context.feishu?.appToken
    if (!appToken) return
    if (!settings.feishuAccessToken && !import.meta.env.VITE_FEISHU_APP_ID) return

    latestReqApp.current = appToken
    setCtxLoading(true)
    setCtxError('')
    try {
      const token = await resolveToken(settings)
      const ctx = await fetchBaseCtx(token, appToken, context.feishu?.tableId)
      if (latestReqApp.current !== appToken) return // a newer Base load superseded this one
      setBaseCtx(ctx)
      lastLoadedApp.current = appToken
      if (ctx.appName) onBaseName?.(appToken, ctx.appName)
    } catch (err) {
      if (latestReqApp.current !== appToken) return // stale failure — don't clobber the newer Base
      setCtxError(err instanceof Error ? err.message : String(err))
    } finally {
      if (latestReqApp.current === appToken) setCtxLoading(false)
    }
  }
  loadBaseCtxRef.current = loadBaseCtx

  // Refresh context on demand (also re-fetches after structural changes)
  function refreshCtx() {
    lastLoadedApp.current = ''
    setBaseCtx(null)
    loadBaseCtx()
  }

  async function handleSend(text: string) {
    if (!text.trim() || streaming) return

    // Bind this whole turn to the session that's active NOW — so the streamed reply
    // always lands here even if the user navigates / the active session switches.
    const turnId = activeSessionId
    const setTurn = (u: ChatMessage[] | ((p: ChatMessage[]) => ChatMessage[])) =>
      turnId ? setMessagesFor(turnId, u) : setMessages(u)
    const appendTurn = (msg: ChatMessage) =>
      setTurn((prev) => {
        const i = prev.findIndex((m) => m.id === msg.id)
        if (i === -1) return [...prev, msg]
        const next = [...prev]; next[i] = msg; return next
      })

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(), role: 'user', content: text.trim(), createdAt: Date.now(),
    }
    // Derive the agent history from the session's CURRENT messages, not the render
    // snapshot `messages`. setTurn's updater runs synchronously against the session
    // cache (useSessions), so any write that landed since the last render is included —
    // and we append (not clobber) so we never overwrite newer state with a stale array.
    let allMessages: ChatMessage[] = [...messages, userMsg]
    setTurn((prev) => {
      allMessages = [...prev, userMsg]
      return allMessages
    })
    setStreaming(true)

    // New turn → cancel any still-running prior turn, then bind this turn's signal.
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    // Each agentic ROUND gets its own assistant bubble, in order. A tool call ends
    // the current round's bubble so the next round's text starts a NEW bubble BELOW
    // the tool result — instead of all rounds appending to the first bubble.
    let streamId: string | null = null

    try {
      await runAgent(allMessages, settings, context, {
        onChunk(chunk) {
          if (!streamId) {
            streamId = crypto.randomUUID()
            appendTurn({ id: streamId, role: 'assistant', content: chunk, createdAt: Date.now(), isStreaming: true })
          } else {
            const id = streamId
            setTurn(prev => prev.map(m => m.id === id ? { ...m, content: (m.content ?? '') + chunk } : m))
          }
        },
        onAssistantMessage(msg) {
          if (streamId) {
            // Finalize the bubble we streamed into (keep its position + id).
            const id = streamId
            setTurn(prev => prev.map(m => m.id === id ? { ...msg, id, isStreaming: false } : m))
            streamId = null
          } else if (msg.content) {
            // A round produced text without chunked streaming — append it as its own bubble.
            appendTurn({ ...msg, id: crypto.randomUUID(), isStreaming: false })
          }
          // tool-only round (no content) → nothing here; the tool indicator shows it
        },
        onToolStart(name, args) {
          streamId = null // current round's text is done; next text → new bubble below
          appendTurn({
            id: `tc-start-${name}-${Date.now()}`,
            role: 'assistant',
            content: null,
            tool_calls: [{ id: `tmp-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
            createdAt: Date.now(),
          })
        },
        onToolEnd(toolCallId, _result, isError) {
          if (!isError) refreshCtxIfStructuralChange(toolCallId)
        },
        onToolMessage: (msg) => {
          appendTurn(msg)
          // render_data_app returns a marker → pull live data + render in the page overlay.
          if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.includes('__dataviz')) {
            try {
              const p = JSON.parse(msg.content) as { __dataviz?: boolean; name: string; code: string; source: VizSource }
              if (p?.__dataviz) void renderDataVizResult(p, appendTurn)
            } catch { /* not a dataviz result */ }
          }
        },
        requestConfirmation,
        askUser,
      }, baseCtx ?? undefined, ac.signal)
    } catch (err) {
      // Cancelled turn (unmount / superseded by a new send) — not a real error.
      const aborted = ac.signal.aborted || (err instanceof Error && err.name === 'AbortError')
      if (!aborted) {
        appendTurn({
          id: crypto.randomUUID(), role: 'assistant',
          content: `❌ ${err instanceof Error ? err.message : String(err)}`, createdAt: Date.now(),
        })
      }
    } finally {
      // Only the current turn owns the streaming flag; a superseded turn must not
      // flip it off under the newer one. The streamed bubble is this turn's own → always finalize.
      if (abortRef.current === ac) { abortRef.current = null; setStreaming(false) }
      if (streamId) {
        const id = streamId
        setTurn(p => p.map(m => m.id === id ? { ...m, isStreaming: false } : m))
      }
    }
  }

  // render_data_app result → pull the live full dataset and render it in the page overlay.
  // `append` is the turn-bound writer (setMessagesFor(turnId, …)) so a failure lands in the
  // conversation it belongs to — not whatever session happens to be active now (fetchVizData is
  // a network round-trip; the user may have switched sessions while it was in flight).
  async function renderDataVizResult(p: { name: string; code: string; source: VizSource }, append: (m: ChatMessage) => void) {
    try {
      const full = await fetchVizData(settings, p.source, 2000)
      const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
      await sendVizToActiveTab({ code: p.code, data: full.rows, name: p.name, theme })
    } catch (e) {
      // Surface a connection/render failure as a chat message instead of silently dropping it.
      append({
        id: crypto.randomUUID(), role: 'assistant',
        content: `⚠ 可视化没能显示：${e instanceof Error ? e.message : String(e)}`, createdAt: Date.now(),
      })
    }
  }

  // Silently refresh context after field/table edits. Debounced on a per-instance ref timer
  // (cleared on unmount) and reading the LATEST context/loadBaseCtx via refs — the old
  // window-global timer's callback closed over the Base active when it was scheduled, so a tool
  // finishing on Base A after the user navigated to B would re-load A and overwrite B's context.
  function refreshCtxIfStructuralChange(_toolCallId: string) {
    if (ctxRefreshTimer.current) clearTimeout(ctxRefreshTimer.current)
    ctxRefreshTimer.current = setTimeout(() => {
      if (contextRef.current.feishu?.appToken) {
        lastLoadedApp.current = ''
        loadBaseCtxRef.current()
      }
    }, 1500)
  }

  return (
    <div className="chat-panel">
      {/* Session switcher bar */}
      <button className="session-bar" onClick={onOpenSessions} title="切换 / 管理会话">
        <svg className="session-bar-ic" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
        </svg>
        <span className="session-bar-title">{sessionTitle || '会话'}</span>
        <svg className="session-bar-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {/* Base context bar — only shown when on a Base page */}
      {context.feishu?.isBase && (
        <BaseContextBadge
          ctx={baseCtx}
          loading={ctxLoading}
          error={ctxError}
          settings={settings}
          onRefresh={refreshCtx}
        />
      )}

      <MessageList
        messages={messages}
        onExample={disabled || streaming ? undefined : handleSend}
        kind={context.feishu?.kind}
      />

      {/* Inline delete/write confirmation — a button in the conversation area, no typing.
          'write' (批量改/跨表回填) uses a neutral icon + label so it's not mislabeled as 删除. */}
      {(pendingConfirm?.req.kind === 'delete' || pendingConfirm?.req.kind === 'write') && (
        <div className="del-confirm" role="alertdialog">
          <span className="del-confirm-icon">{pendingConfirm.req.kind === 'delete' ? '🗑️' : '✏️'}</span>
          <span className="del-confirm-text">
            确认执行：{pendingConfirm.req.summary || pendingConfirm.req.toolName}
          </span>
          <button
            className="del-confirm-btn del-confirm-btn--danger"
            onClick={() => { pendingConfirm.resolve('confirm'); setPendingConfirm(null) }}
          >
            {pendingConfirm.req.kind === 'delete' ? '删除' : '确认'}
          </button>
          <button
            className="del-confirm-btn del-confirm-btn--ghost"
            onClick={() => { pendingConfirm.resolve('cancel'); setPendingConfirm(null) }}
          >
            取消
          </button>
        </div>
      )}

      {/* One-click 撤销 for the assistant's last record deletion — shown right here in the
          conversation flow (under the delete), reading the undo the agent stashed. */}
      <UndoBar settings={settings} />

      {/* Field picker — Feishu Base grids are canvas-rendered (no DOM text to select), so
          we list the current table's fields from the structure we already read. Click a
          field → it drops into the input for a precise edit. */}
      {(() => {
        if (!baseCtx?.tables?.length) return null
        const tid = context.feishu?.tableId || baseCtx.currentTableId
        const table = baseCtx.tables.find((t) => t.tableId === tid) ?? baseCtx.tables[0]
        const fields = table?.fields ?? []
        if (!fields.length) return null
        return (
          <div className="field-chips" title="点击字段插入到输入框，再描述要做的修改">
            {fields.map((f) => (
              <button
                key={f.fieldId}
                className="field-chip"
                onClick={() => inputRef.current?.insert(`${f.fieldName} (id:${f.fieldId})`)}
                title={`${f.fieldName}（${f.typeName}）· ${f.fieldId}`}
              >
                {f.fieldName}
              </button>
            ))}
          </div>
        )
      })()}

      <InputBar
        ref={inputRef}
        onSend={handleSend}
        disabled={disabled || streaming}
        onClear={() => setMessages([])}
        voiceEnabled={WEB_SPEECH_ALLOWED && settings.voiceInput !== false}
        selection={context.selectedText}
      />

      {pendingConfirm?.req.kind === 'create_base' && (
        <ConfirmDialog
          req={pendingConfirm.req}
          onChoose={(choice) => {
            pendingConfirm.resolve(choice)
            setPendingConfirm(null)
          }}
        />
      )}

      {pendingAsk && (
        <ChoiceDialog
          req={pendingAsk.req}
          onChoose={(label) => {
            pendingAsk.resolve(label)
            setPendingAsk(null)
          }}
          onCancel={() => {
            pendingAsk.resolve(null)
            setPendingAsk(null)
          }}
        />
      )}
    </div>
  )
}
