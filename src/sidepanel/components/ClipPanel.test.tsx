// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ClipPanel from './ClipPanel'
import { DEFAULT_SETTINGS } from '../../shared/types'
import type { ClipCapture } from '../../shared/clip/types'

afterEach(cleanup)

const clip: ClipCapture = {
  url: 'https://news.example.com/article/42',
  title: '一则新闻标题',
  selectedText: '',
  content: '这是被剪藏的正文内容，应当在发送前完整预览。',
  capturedAt: 1,
  truncated: false,
}

describe('ClipPanel', () => {
  it('previews the captured content and source BEFORE any action (informed consent)', () => {
    render(<ClipPanel settings={DEFAULT_SETTINGS} clip={clip} disabled={false} onClose={() => {}} />)
    expect(screen.getByText(/被剪藏的正文内容/)).toBeTruthy()
    expect(screen.getByText('https://news.example.com/article/42')).toBeTruthy()
    // Nothing about a target Base is requested yet — preview is purely local.
    expect(screen.queryByPlaceholderText(/base\//)).toBeNull()
  })

  it('advances to target selection only on user action', () => {
    render(<ClipPanel settings={DEFAULT_SETTINGS} clip={clip} disabled={false} onClose={() => {}} />)
    fireEvent.click(screen.getByText('选择目标 →'))
    expect(screen.getByPlaceholderText(/base\//)).toBeTruthy()
  })

  it('gates the flow when not configured (disabled)', () => {
    render(<ClipPanel settings={DEFAULT_SETTINGS} clip={clip} disabled={true} onClose={() => {}} />)
    expect((screen.getByText('选择目标 →') as HTMLButtonElement).disabled).toBe(true)
  })

  it('a screenshot clip shows the image + recognize button (not the target picker yet)', () => {
    const shot: ClipCapture = { ...clip, content: '', imageDataUrl: 'data:image/png;base64,AAAA' }
    render(<ClipPanel settings={DEFAULT_SETTINGS} clip={shot} disabled={false} onClose={() => {}} />)
    expect(screen.getByAltText('网页截图')).toBeTruthy()
    expect(screen.getByRole('button', { name: /识别表格/ })).toBeTruthy()
    expect(screen.queryByText('选择目标 →')).toBeNull() // consent gate: nothing sent until 识别
  })

  it('shows a friendly error for an unsupported page', () => {
    render(<ClipPanel settings={DEFAULT_SETTINGS} clip={null} error="此页面不支持剪藏" disabled={false} onClose={() => {}} />)
    expect(screen.getByText(/此页面不支持剪藏/)).toBeTruthy()
  })

  it('offers create-new for Base, Sheet and Doc', () => {
    render(<ClipPanel settings={DEFAULT_SETTINGS} clip={clip} disabled={false} onClose={() => {}} />)
    fireEvent.click(screen.getByText('选择目标 →'))
    expect(screen.getByText('多维表格')).toBeTruthy()
    expect(screen.getByText('电子表格')).toBeTruthy()
    expect(screen.getByText('文档')).toBeTruthy()
  })

  it('detects a Doc URL and offers the insert-into-doc action (no Base table picker)', async () => {
    render(<ClipPanel settings={DEFAULT_SETTINGS} clip={clip} disabled={false} onClose={() => {}} />)
    fireEvent.click(screen.getByText('选择目标 →'))
    fireEvent.change(screen.getByPlaceholderText(/sheets/), { target: { value: 'https://x.feishu.cn/docx/DocABC123' } })
    fireEvent.click(screen.getByText('加载'))
    expect(await screen.findByText(/插入文档/)).toBeTruthy()
  })
})

describe('ClipPanel — 采集模板 presets', () => {
  let store: Record<string, unknown>
  beforeEach(() => {
    store = {}
    ;(globalThis as unknown as { chrome: unknown }).chrome = {
      storage: { local: {
        get: (_keys: string[], cb: (r: Record<string, unknown>) => void) => cb(store),
        set: (obj: Record<string, unknown>) => { Object.assign(store, obj) },
      } },
    }
  })
  afterEach(() => { cleanup(); delete (globalThis as { chrome?: unknown }).chrome })

  const preset = (over: Record<string, unknown> = {}) => ({
    id: 'p1', site: 'news.example.com', label: '电子表格 · 持仓表',
    kind: 'sheet', token: 'shtX', name: '持仓表', createdAt: 1, ...over,
  })

  it('no matching preset → no one-click button', () => {
    render(<ClipPanel settings={DEFAULT_SETTINGS} clip={clip} disabled={false} onClose={() => {}} />)
    expect(screen.queryByText(/一键写入|持仓表/)).toBeNull()
    expect(screen.getByText('选择目标 →')).toBeTruthy()
  })

  it('matches by hostname → shows a one-click write button in preview', async () => {
    store._clip_presets = [preset()]
    render(<ClipPanel settings={DEFAULT_SETTINGS} clip={clip} disabled={false} onClose={() => {}} />)
    expect(await screen.findByText('⭐ 电子表格 · 持仓表')).toBeTruthy()
  })

  it('does NOT show presets from a different host', () => {
    store._clip_presets = [preset({ site: 'other.example.com' })]
    render(<ClipPanel settings={DEFAULT_SETTINGS} clip={clip} disabled={false} onClose={() => {}} />)
    expect(screen.queryByText(/持仓表/)).toBeNull()
  })

  it('lists multiple presets for the same host', async () => {
    store._clip_presets = [preset(), preset({ id: 'p2', label: '文档 · 笔记', kind: 'doc', token: 'docY', name: '笔记' })]
    render(<ClipPanel settings={DEFAULT_SETTINGS} clip={clip} disabled={false} onClose={() => {}} />)
    expect(await screen.findByText('⭐ 电子表格 · 持仓表')).toBeTruthy()
    expect(screen.getByText('⭐ 文档 · 笔记')).toBeTruthy()
  })

  it('saves a preset from the target step (Doc) and persists to storage', async () => {
    render(<ClipPanel settings={DEFAULT_SETTINGS} clip={clip} disabled={false} onClose={() => {}} />)
    fireEvent.click(screen.getByText('选择目标 →'))
    fireEvent.change(screen.getByPlaceholderText(/sheets/), { target: { value: 'https://x.feishu.cn/docx/DocABC123' } })
    fireEvent.click(screen.getByText('加载'))
    await screen.findByText(/插入文档/)
    fireEvent.click(screen.getByText('⭐ 保存为采集模板'))
    const saved = store._clip_presets as Array<{ kind: string; site: string; token: string }>
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ kind: 'doc', site: 'news.example.com', token: 'DocABC123' })
  })
})
