import React, { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../../shared/types'
import { openUrlInNewTab } from '../../shared/url'
import './MessageList.css'

type ResourceKind = 'base' | 'sheet' | 'doc'

interface Props {
  messages: ChatMessage[]
  /** Click an example chip to send it. Omit (undefined) to render chips disabled. */
  onExample?: (text: string) => void
  /** Current Feishu resource — drives a capability list tailored to it. 'wiki' is a
   *  transient unresolved state, treated as the general guide. */
  kind?: ResourceKind | 'wiki'
}

// Per-resource welcome: a short capability summary + 10 one-click quick actions.
const GUIDE: Record<ResourceKind | 'none', { title: string; sub: string; caps: string[]; examples: string[] }> = {
  base: {
    title: '多维表格助手',
    sub: '当前页面是多维表格（Base）。',
    caps: ['表 / 字段 / 记录 / 视图 / 仪表盘', '公式、汇总透视、去重、跨表 VLOOKUP、数据质检'],
    examples: [
      '创建一个项目管理表格，含名称、状态、优先级、负责人、截止日期字段，并加 5 条示例数据',
      '在当前表格新增"进度"单选字段：未开始 / 进行中 / 已完成',
      '给当前表加"数量""单价"字段，再加"小计 = 数量*单价"公式字段',
      '按"状态"分组统计每组的记录数和金额总和',
      '为当前表创建一个按状态分列的看板视图',
      '把"状态=待处理"的记录批量改成"进行中"',
      '找出"邮箱"重复的记录并去重（先预览要删几条）',
      '用 A 表的"工号"去 B 表匹配，把"部门"回填到 A 表',
      '把当前数据表导出成一个新的电子表格',
      '体检这张表：空必填 / 重复值 / 数值异常，生成报告',
    ],
  },
  sheet: {
    title: '电子表格助手',
    sub: '当前页面是电子表格（Spreadsheet）。',
    caps: ['工作表、单元格读写、追加行', '整列公式、查找替换、数字格式、增删行列'],
    examples: [
      '在 A1:C1 写表头"姓名 / 部门 / 工资"，再追加 3 行示例数据',
      '把 C 列 C2:C10 填上 =A{row}*B{row} 公式',
      '把 D 列设成人民币格式 ¥#,##0.00',
      '读取 A1:D20 的内容给我看',
      '在 F 列用 =SUM(B{row}:E{row}) 求每行合计',
      '把 E 列设成百分比格式 0.0%',
      '在第 1 行上方插入 2 个空行',
      '新建一个"汇总"工作表',
      '把选区里的"未完成"全部替换成"进行中"',
      '删除第 5 到第 8 行',
    ],
  },
  doc: {
    title: '文档助手',
    sub: '当前页面是文档（Docs）。',
    caps: ['读正文 / 总结', 'Markdown 成文、插入标题/列表/引用/代码/待办/表格、删块'],
    examples: [
      '读一下当前文档内容并总结要点',
      '在文档开头插入二级标题"本周进展"和三条要点',
      '用 Markdown 帮我写一份项目周报并插入当前文档',
      '在文末加一个待办清单：设计 / 开发 / 测试 / 上线',
      '在文档里插入一个 3 列表格：任务 / 负责人 / 截止日期',
      '列出文档里所有标题，生成一个目录',
      '给文档加一个代码块示例',
      '在文末追加一段引用说明',
      '把第一段读出来，帮我改写得更正式',
      '告诉我文档有哪些段落，我要删其中一段',
    ],
  },
  none: {
    title: '飞书文档AI助手',
    sub: '用自然语言操作飞书多维表格 / 电子表格 / 文档。打开对应页面后会自动识别并列出能做的事。',
    caps: ['多维表格：表/字段/记录/视图 + 汇总/去重/跨表/质检', '电子表格：单元格/公式/格式', '文档：成文/插入/表格'],
    examples: [
      '新建一个项目管理多维表格，含名称、状态、负责人、截止日期字段',
      '帮我建一个 CRM 客户管理系统',
      '建一个电商订单管理表',
      '创建一个考勤记录表',
      '建一个人员花名册',
      '新建一个电子表格做月度预算表',
      '做一张数据分析汇总表',
      '新建一篇文档写项目周报',
      '新建一个会议纪要文档',
      '新建一个待办事项清单文档',
    ],
  },
}

export default function MessageList({ messages, onExample, kind }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // `behavior:'auto'` (instant), not 'smooth' — this fires on every streamed token (a new
    // messages ref per chunk), and a smooth scroll restarting mid-animation each token stutters
    // and never catches the bottom. Instant pins to the bottom per token cleanly.
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [messages])

  const visible = messages.filter((m) => m.role !== 'system')

  return (
    <div className="msg-list">
      {visible.length === 0 && <Welcome kind={kind} onExample={onExample} />}
      {visible.map((m) => <MessageItem key={m.id} msg={m} />)}
      <div ref={bottomRef} />
    </div>
  )
}

function Welcome({ kind, onExample }: { kind?: ResourceKind | 'wiki'; onExample?: (text: string) => void }) {
  const g = GUIDE[kind === 'base' || kind === 'sheet' || kind === 'doc' ? kind : 'none']
  return (
    <div className="welcome">
      <div className="welcome-icon">✦</div>
      <p className="welcome-title">{g.title}</p>
      <p className="welcome-sub">{g.sub}</p>

      <div className="welcome-caps">
        <span className="welcome-caps-label">我能做</span>
        <ul className="welcome-caps-list">
          {g.caps.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
      </div>

      <div className="welcome-examples">
        <span className="welcome-examples-label">试试看（点击发送）</span>
        {g.examples.map((ex) => (
          <button
            key={ex}
            type="button"
            className="example-chip"
            onClick={() => onExample?.(ex)}
            disabled={!onExample}
            title={onExample ? '点击发送' : '请先在设置中完成配置'}
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  )
}

// Memoized: ChatPanel rebuilds the whole messages array every streamed token, but only the
// in-flight bubble's object identity changes. Without memo, EVERY message re-parses its markdown
// per token → O(n²) jank on long replies. A shallow `msg` compare skips the stable bubbles.
const MessageItem = React.memo(function MessageItem({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'tool') return <ToolResult msg={msg} />
  if (msg.role === 'assistant' && msg.tool_calls?.length && !msg.content) return <ToolCallIndicator msg={msg} />
  if (msg.role === 'user') return <UserBubble msg={msg} />
  return <AssistantBubble msg={msg} />
})

function UserBubble({ msg }: { msg: ChatMessage }) {
  return (
    <div className="msg-row msg-row--user">
      <div className="bubble bubble--user">{msg.content}</div>
    </div>
  )
}

function AssistantBubble({ msg }: { msg: ChatMessage }) {
  const text = msg.content ?? ''
  return (
    <div className="msg-row msg-row--assistant">
      <div className="bubble bubble--assistant">
        <MarkdownText text={text} />
        {msg.isStreaming && <span className="cursor">▋</span>}
      </div>
    </div>
  )
}

// Shown only while a tool is being called — just the tool name, no arguments
// (which can contain sensitive ids like app_token).
function ToolCallIndicator({ msg }: { msg: ChatMessage }) {
  const tc = msg.tool_calls![0]
  return (
    <div className="tool-call">
      <span className="tool-call-icon">⚙</span>
      <span className="tool-call-name">{tc.function.name}</span>
    </div>
  )
}

// Collapsed by default to a compact success/failure chip — no raw content (which
// may hold ids / PII). Click 查看 to expand the full result on demand.
function ToolResult({ msg }: { msg: ChatMessage }) {
  const [expanded, setExpanded] = useState(false)
  const content = msg.content ?? ''
  const isError = content.startsWith('Error:')
  const label = msg.name && msg.name !== 'ok' && msg.name !== 'error' ? msg.name : ''

  return (
    <div className={`tool-result ${isError ? 'tool-result--error' : ''}`}>
      <button className="tool-result-header" onClick={() => setExpanded((v) => !v)}>
        <span>{isError ? '❌ 失败' : '✓ 完成'}{label ? ` · ${label}` : ''}</span>
        <span className="tool-result-toggle">{expanded ? '收起' : '查看'}</span>
      </button>
      {expanded && <pre className="tool-result-body">{content}</pre>}
    </div>
  )
}

function MarkdownText({ text }: { text: string }) {
  // Minimal markdown: bold, inline code, code blocks, lists
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      // A fenced block that's just a URL (models sometimes "format" the open link this
      // way) would be a dead monospace string — render it as a clickable link instead.
      const joined = codeLines.join('\n').trim()
      const codeUrl = safeHref(joined)
      if (codeUrl && !/\s/.test(joined)) {
        elements.push(<p key={i} className="md-p">{linkEl(codeUrl, codeUrl, i)}</p>)
      } else {
        elements.push(
          <pre key={i} className="md-code-block">
            {lang && <span className="md-code-lang">{lang}</span>}
            <code>{codeLines.join('\n')}</code>
          </pre>
        )
      }
    } else if (isTableHeader(lines, i)) {
      // GitHub-style table: header row, a |---|---| separator, then body rows.
      const header = splitCells(line)
      let j = i + 2
      const rows: string[][] = []
      while (j < lines.length && lines[j].trim().startsWith('|')) {
        rows.push(splitCells(lines[j]))
        j++
      }
      elements.push(
        <table key={i} className="md-table">
          <thead>
            <tr>{header.map((h, k) => <th key={k}>{inlineFormat(h)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>{header.map((_, ci) => <td key={ci}>{inlineFormat(r[ci] ?? '')}</td>)}</tr>
            ))}
          </tbody>
        </table>
      )
      i = j - 1 // the trailing i++ steps past the last consumed body row
    } else if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="md-h3">{inlineFormat(line.slice(4))}</h3>)
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="md-h2">{inlineFormat(line.slice(3))}</h2>)
    } else if (line.startsWith('# ')) {
      elements.push(<h2 key={i} className="md-h2">{inlineFormat(line.slice(2))}</h2>)
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(<li key={i} className="md-li">{inlineFormat(line.slice(2))}</li>)
    } else if (line.trim() === '') {
      elements.push(<br key={i} />)
    } else {
      elements.push(<p key={i} className="md-p">{inlineFormat(line)}</p>)
    }
    i++
  }

  return <div className="md-content">{elements}</div>
}

const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? url : null)

// Split a markdown table row "| a | b |" → ['a','b'] (drop the outer pipes).
function splitCells(row: string): string[] {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
}

// A table starts when this line is a "| … |" row and the NEXT line is a |---|:---| separator.
function isTableHeader(lines: string[], i: number): boolean {
  const sep = lines[i + 1]
  return (
    lines[i].trim().startsWith('|') &&
    !!sep &&
    sep.includes('-') &&
    /^\s*\|?[\s:|-]+\|?\s*$/.test(sep)
  )
}

// A plain <a target="_blank"> click is unreliable inside a Chrome side panel (the panel
// swallows the navigation), so links look "dead". Open via chrome.tabs.create instead.
function openExternal(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
  e.preventDefault()
  openUrlInNewTab(href)
}

function linkEl(href: string, label: string, key: React.Key) {
  return (
    <a key={key} className="md-link" href={href} target="_blank" rel="noreferrer" onClick={(e) => openExternal(e, href)}>
      {label}
    </a>
  )
}

// A URL the model wrapped in backticks (`https://…`) or as a `[text](url)` inside backticks
// should still be clickable — return an anchor, else null (caller keeps the <code>).
function linkInCode(inner: string, key: React.Key): React.ReactNode | null {
  const md = inner.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
  if (md && safeHref(md[2])) return linkEl(safeHref(md[2])!, md[1], key)
  const href = safeHref(inner.trim())
  return href ? linkEl(href, inner.trim(), key) : null
}

function inlineFormat(text: string): React.ReactNode {
  // Split on inline code / bold / markdown links / bare URLs so links render as
  // clickable anchors (created-document links open in a new tab — no copy-paste).
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s)]+)/g)
  return parts.map((part, i) => {
    if (!part) return null
    if (part.startsWith('`') && part.endsWith('`')) {
      const inner = part.slice(1, -1)
      // Models often wrap the "open" URL in backticks → it'd render as a dead monospace
      // string. If the code span is really a URL/link, make it clickable instead.
      return linkInCode(inner, i) ?? <code key={i} className="md-code">{inner}</code>
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    const mdLink = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (mdLink) {
      const href = safeHref(mdLink[2])
      return href ? linkEl(href, mdLink[1], i) : mdLink[1]
    }
    if (safeHref(part)) {
      return linkEl(part, part, i)
    }
    return part
  })
}
