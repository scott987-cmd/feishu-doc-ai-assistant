// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { ChatMessage } from '../../shared/types'
import MessageList from './MessageList'

beforeAll(() => {
  // jsdom has no scrollIntoView
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

const mk = (m: Partial<ChatMessage>): ChatMessage =>
  ({ id: Math.random().toString(), role: 'assistant', content: '', createdAt: 0, ...m } as ChatMessage)

describe('MessageList — markdown links are clickable', () => {
  it('renders a [text](url) markdown link as a new-tab anchor', () => {
    render(<MessageList messages={[mk({ role: 'assistant', content: '打开：[项目管理](https://x.feishu.cn/base/AbC123)' })]} />)
    const link = screen.getByRole('link', { name: '项目管理' }) as HTMLAnchorElement
    expect(link.href).toBe('https://x.feishu.cn/base/AbC123')
    expect(link.target).toBe('_blank')
  })

  it('linkifies a markdown link INSIDE a heading (## / ### ) — not raw text', () => {
    render(<MessageList messages={[mk({ role: 'assistant', content: '## 🎉 [打开 CRM 客户管理系统](https://x.feishu.cn/base/RqZEbD1)' })]} />)
    const link = screen.getByRole('link', { name: '打开 CRM 客户管理系统' }) as HTMLAnchorElement
    expect(link.href).toBe('https://x.feishu.cn/base/RqZEbD1')
  })

  it('auto-links a bare https URL', () => {
    render(<MessageList messages={[mk({ content: '见 https://x.feishu.cn/docx/Doc1' })]} />)
    expect((screen.getByRole('link') as HTMLAnchorElement).href).toBe('https://x.feishu.cn/docx/Doc1')
  })

  it('does NOT linkify a javascript: url (xss guard)', () => {
    render(<MessageList messages={[mk({ content: '[x](javascript:alert(1))' })]} />)
    expect(screen.queryByRole('link')).toBeNull()
  })

  // Models (DeepSeek etc.) often wrap the "open" URL in backticks/code, which used to
  // render as a dead monospace string — the "一串URL字符,点不了" report. These must still
  // become clickable links.
  it('linkifies a URL the model wrapped in inline-code backticks', () => {
    render(<MessageList messages={[mk({ content: '打开：`https://x.example.feishu.cn/base/bas1`' })]} />)
    const link = screen.getByRole('link') as HTMLAnchorElement
    expect(link.href).toBe('https://x.example.feishu.cn/base/bas1')
  })

  it('linkifies a markdown link the model wrapped in backticks', () => {
    render(<MessageList messages={[mk({ content: '打开 `[打开 Base](https://x.example.feishu.cn/base/bas1)`' })]} />)
    const link = screen.getByRole('link', { name: '打开 Base' }) as HTMLAnchorElement
    expect(link.href).toBe('https://x.example.feishu.cn/base/bas1')
  })

  it('linkifies a fenced code block that is just a URL', () => {
    render(<MessageList messages={[mk({ content: '已建好！\n```\nhttps://x.example.feishu.cn/base/bas1\n```' })]} />)
    const link = screen.getByRole('link') as HTMLAnchorElement
    expect(link.href).toBe('https://x.example.feishu.cn/base/bas1')
  })

  it('keeps non-URL inline code as plain <code> (no false linkify)', () => {
    render(<MessageList messages={[mk({ content: '字段叫 `field_id`' })]} />)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('renders a GitHub-style markdown table (not raw pipes)', () => {
    const content = '汇总：\n| 字段 | 类型 | 说明 |\n|------|------|------|\n| 姓名 | 文本 | 员工姓名 |\n| 工号 | 文本 | 员工工号 |'
    const { container } = render(<MessageList messages={[mk({ content })]} />)
    expect(container.querySelectorAll('table')).toHaveLength(1)
    expect(container.querySelectorAll('th')).toHaveLength(3)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(container.querySelector('td')?.textContent).toBe('姓名')
  })

  it('clicking a link opens it via chrome.tabs.create (side panel reliable jump)', () => {
    const create = vi.fn(() => Promise.resolve({} as chrome.tabs.Tab))
    ;(globalThis as unknown as { chrome: unknown }).chrome = { tabs: { create } }
    render(<MessageList messages={[mk({ content: '👉 [打开 Base](https://x.example.feishu.cn/base/bas1)' })]} />)
    const link = screen.getByRole('link', { name: '打开 Base' })
    fireEvent.click(link)
    expect(create).toHaveBeenCalledWith({ url: 'https://x.example.feishu.cn/base/bas1' })
    delete (globalThis as unknown as { chrome?: unknown }).chrome
  })
})

describe('MessageList — tool result collapse / 查看', () => {
  it('hides raw content until 查看 is clicked, then toggles', () => {
    render(<MessageList messages={[mk({ role: 'tool', name: 'create_table', content: '{"app_token":"secret123"}' })]} />)
    // Collapsed: no raw content shown
    expect(screen.queryByText(/secret123/)).toBeNull()
    fireEvent.click(screen.getByText(/查看/))
    expect(screen.getByText(/secret123/)).toBeTruthy()
    // Toggle label flips to 收起 and collapses again
    fireEvent.click(screen.getByText(/收起/))
    expect(screen.queryByText(/secret123/)).toBeNull()
  })

  it('shows 失败 for error results', () => {
    render(<MessageList messages={[mk({ role: 'tool', name: 'create_table', content: 'Error: boom' })]} />)
    expect(screen.getByText(/失败/)).toBeTruthy()
  })
})

describe('MessageList — tool call indicator hides sensitive args', () => {
  it('shows the tool name but not app_token', () => {
    render(<MessageList messages={[mk({
      role: 'assistant', content: null,
      tool_calls: [{ id: 't1', type: 'function', function: { name: 'create_table', arguments: '{"app_token":"secretXYZ"}' } }],
    })]} />)
    expect(screen.getByText('create_table')).toBeTruthy()
    expect(screen.queryByText(/secretXYZ/)).toBeNull()
  })
})

describe('MessageList — welcome example chips', () => {
  it('clicking a chip sends its text via onExample', () => {
    const onExample = vi.fn()
    render(<MessageList messages={[]} onExample={onExample} />)
    const chips = screen.getAllByRole('button')
    fireEvent.click(chips[0])
    expect(onExample).toHaveBeenCalledOnce()
    expect(onExample.mock.calls[0][0]).toContain('项目管理')
  })

  it('chips are disabled when onExample is omitted', () => {
    render(<MessageList messages={[]} />)
    for (const chip of screen.getAllByRole('button')) {
      expect((chip as HTMLButtonElement).disabled).toBe(true)
    }
  })
})

describe('MessageList — resource-aware welcome capabilities', () => {
  it('shows Spreadsheet capabilities when on a sheet', () => {
    render(<MessageList messages={[]} kind="sheet" />)
    expect(screen.getByText('电子表格助手')).toBeTruthy()
    expect(screen.getByText(/整列公式/)).toBeTruthy()
  })

  it('shows Doc capabilities when on a doc', () => {
    render(<MessageList messages={[]} kind="doc" />)
    expect(screen.getByText('文档助手')).toBeTruthy()
    expect(screen.getAllByText(/Markdown/).length).toBeGreaterThan(0)
  })

  it('offers 10 quick actions per resource type', () => {
    render(<MessageList messages={[]} kind="sheet" onExample={() => {}} />)
    expect(screen.getAllByRole('button')).toHaveLength(10)
  })

  it('shows Base capabilities when on a base', () => {
    render(<MessageList messages={[]} kind="base" />)
    expect(screen.getByText('多维表格助手')).toBeTruthy()
  })

  it('falls back to a general guide off-resource', () => {
    render(<MessageList messages={[]} />)
    expect(screen.getByText('飞书文档AI助手')).toBeTruthy()
  })
})
