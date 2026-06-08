import { forwardRef, useEffect, useImperativeHandle, useRef, useState, KeyboardEvent } from 'react'
import './InputBar.css'

/** Imperative handle so parents (e.g. a field picker) can drop text into the box. */
export interface InputBarHandle { insert: (t: string) => void }

interface Props {
  onSend: (text: string) => void
  onClear: () => void
  disabled: boolean
  /** Show the 🎤 voice-input button (Web Speech API). Off for locked/private builds. */
  voiceEnabled?: boolean
  /** The user's current page selection — auto-filled into the box so they can describe an
   *  edit right after selecting a field/cell. */
  selection?: string
}

// Minimal typing for the (un-typed) webkitSpeechRecognition API.
interface SpeechRec {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((e: { error?: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}
const SpeechRecognitionCtor: (new () => SpeechRec) | undefined =
  (typeof window !== 'undefined' &&
    ((window as unknown as { webkitSpeechRecognition?: new () => SpeechRec; SpeechRecognition?: new () => SpeechRec })
      .webkitSpeechRecognition ||
      (window as unknown as { SpeechRecognition?: new () => SpeechRec }).SpeechRecognition)) || undefined

const InputBar = forwardRef<InputBarHandle, Props>(function InputBar(
  { onSend, onClear, disabled, voiceEnabled, selection },
  ref,
) {
  const [text, setText] = useState('')
  const [listening, setListening] = useState(false)
  const [micError, setMicError] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const recRef = useRef<SpeechRec | null>(null)
  const textRef = useRef('')
  textRef.current = text
  const lastInsertedRef = useRef('') // the exact string we auto-filled from a selection

  function resize() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }
  useEffect(() => { resize() }, [text])

  // Auto-fill the user's page selection into the box (so they can describe an edit right
  // after selecting). Only when the box is empty or still holds the previous auto-fill —
  // never clobber text the user has typed.
  useEffect(() => {
    const sel = (selection ?? '').trim()
    if (!sel) return
    const filled = sel + ' '
    if (textRef.current === '' || textRef.current === lastInsertedRef.current) {
      lastInsertedRef.current = filled
      setText(filled)
      textareaRef.current?.focus()
    }
  }, [selection])

  // Parent-driven insert (field picker): append to the current text and focus.
  useImperativeHandle(ref, () => ({
    insert(t: string) {
      const s = t.trim()
      if (!s) return
      setText((cur) => (cur.trim() ? cur.trimEnd() + ' ' + s + ' ' : s + ' '))
      textareaRef.current?.focus()
    },
  }), [])

  // Stop any in-flight recognition when the bar unmounts.
  useEffect(() => () => { try { recRef.current?.stop() } catch { /* ignore */ } }, [])

  function submit() {
    const t = text.trim()
    if (!t || disabled) return
    onSend(t)
    setText('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  async function toggleMic() {
    setMicError('')
    if (listening) { try { recRef.current?.stop() } catch { /* ignore */ } return }
    if (!SpeechRecognitionCtor) { setMicError('当前浏览器不支持语音输入'); return }

    // Pre-flight: request mic permission via getUserMedia (the side panel won't reliably
    // prompt for it otherwise). We only need the grant, so stop the tracks immediately.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
    } catch {
      setMicError('麦克风权限被拒绝或不可用：请在地址栏左侧🔒或扩展页给本扩展允许麦克风后重试。')
      return
    }

    const rec = new SpeechRecognitionCtor()
    rec.lang = 'zh-CN'
    rec.interimResults = true
    rec.continuous = false
    const base = text ? text.trimEnd() + ' ' : '' // append to whatever's already typed
    rec.onresult = (e) => {
      let s = ''
      for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript
      setText(base + s)
    }
    rec.onerror = (e) => {
      setListening(false); recRef.current = null
      const code = e?.error ?? ''
      if (code === 'network' || code === 'service-not-allowed') {
        setMicError('语音识别服务连不上——浏览器语音依赖 Google 服务，国内网络通常不可用。')
      } else if (code === 'not-allowed') {
        setMicError('麦克风权限被拒绝，请允许后重试。')
      } else if (code === 'no-speech') {
        setMicError('没听到声音，请靠近麦克风再试。')
      } else {
        setMicError(`语音输入失败（${code || '未知'}）。`)
      }
    }
    rec.onend = () => { setListening(false); recRef.current = null }
    recRef.current = rec
    setListening(true)
    try { rec.start() } catch { setListening(false); setMicError('无法启动语音输入'); recRef.current = null }
  }

  return (
    <div className="input-bar">
      <div className="input-bar-inner">
        <textarea
          ref={textareaRef}
          className="input-textarea"
          placeholder={disabled ? '请先在设置中完成配置（API Key + 飞书账号授权）…' : (listening ? '正在聆听…说完会自动停止' : '描述你想要的表格结构 / 操作…  Enter 发送')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          rows={1}
        />
        <div className="input-actions">
          {voiceEnabled && SpeechRecognitionCtor && (
            <button
              className={`btn-mic ${listening ? 'btn-mic--on' : ''}`}
              onClick={() => void toggleMic()}
              disabled={disabled}
              title={listening ? '停止语音输入' : '语音输入'}
              tabIndex={-1}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="9" y="2" width="6" height="12" rx="3" fill={listening ? 'currentColor' : 'none'} />
                <path d="M5 11a7 7 0 0 0 14 0" /><line x1="12" y1="18" x2="12" y2="22" />
              </svg>
            </button>
          )}
          <button className="btn-clear" onClick={onClear} title="Clear chat" tabIndex={-1}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
            </svg>
          </button>
          <button className="btn-send" onClick={submit} disabled={disabled || !text.trim()} title="Send (Enter)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </div>
      </div>
      <p className="input-hint">{micError || (listening ? '🎙 正在聆听…' : 'Shift+Enter 换行 · Enter 发送')}</p>
    </div>
  )
})

export default InputBar
