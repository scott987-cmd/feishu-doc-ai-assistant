import { describe, it, expect } from 'vitest'
import type { ChatCompletionMessageParam } from 'openai/resources'
import type { ChatMessage, AppSettings, PageContext } from '../types'
import { sanitizeToken, truncateToolResult, checkDestructiveConfirmation, buildApiHistory, assertApiCallAllowed, runAgent, isFileLevelDelete, describeDestructiveOp } from './agent'
import type { AgentCallbacks } from './agent'

describe('sanitizeToken', () => {
  it('passes through a valid Feishu token', () => {
    expect(sanitizeToken('tblAbC123_-x')).toBe('tblAbC123_-x')
  })

  it('trims surrounding whitespace', () => {
    expect(sanitizeToken('  bascn123  ')).toBe('bascn123')
  })

  it('returns undefined for empty / undefined input', () => {
    expect(sanitizeToken(undefined)).toBeUndefined()
    expect(sanitizeToken('')).toBeUndefined()
  })

  it('rejects injection characters', () => {
    expect(() => sanitizeToken('abc/../../etc')).toThrow(/无效 ID 格式/)
    expect(() => sanitizeToken('abc def')).toThrow(/无效 ID 格式/)
    expect(() => sanitizeToken('abc?x=1')).toThrow(/无效 ID 格式/)
  })
})

describe('truncateToolResult', () => {
  it('returns short input unchanged', () => {
    const small = JSON.stringify({ a: 1 })
    expect(truncateToolResult(small)).toBe(small)
  })

  it('truncates oversized input and appends a notice', () => {
    const big = JSON.stringify(
      Array.from({ length: 2000 }, (_, i) => ({ id: i, name: `name-${i}` })),
      null,
      2
    )
    const out = truncateToolResult(big)
    expect(out.length).toBeLessThan(big.length)
    expect(out).toMatch(/结果已截断/)
  })
})

describe('checkDestructiveConfirmation', () => {
  const userMsg = (content: string): ChatCompletionMessageParam => ({ role: 'user', content })

  it('confirms on an explicit affirmative', () => {
    expect(checkDestructiveConfirmation([], [userMsg('确认')])).toBe(true)
    expect(checkDestructiveConfirmation([], [userMsg('yes')])).toBe(true)
    expect(checkDestructiveConfirmation([], [userMsg('删除')])).toBe(true)
  })

  it('rejects vague / passive replies', () => {
    expect(checkDestructiveConfirmation([], [userMsg('你决定吧')])).toBe(false)
    expect(checkDestructiveConfirmation([], [userMsg('随便')])).toBe(false)
  })

  it('rejects when the affirmative is buried in a longer sentence (exact-match only)', () => {
    expect(checkDestructiveConfirmation([], [userMsg('我觉得可以确认一下')])).toBe(false)
  })

  it('rejects when there is no user message at all', () => {
    expect(checkDestructiveConfirmation([], [])).toBe(false)
  })
})

describe('buildApiHistory', () => {
  const msg = (m: Partial<ChatMessage>): ChatMessage =>
    ({ id: m.id ?? Math.random().toString(), role: 'user', content: '', createdAt: 0, ...m } as ChatMessage)

  it('drops placeholder tool_calls that have no matching tool response', () => {
    // Mirrors ChatPanel's UI log: real assistant(tool_calls) + synthetic "tool started"
    // indicator (tmp id, no response) + the real tool result + a follow-up user turn.
    const history: ChatMessage[] = [
      msg({ role: 'user', content: '建一个项目管理表' }),
      msg({
        role: 'assistant', content: null,
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'create_table', arguments: '{}' } }],
      }),
      msg({
        role: 'assistant', content: null, // synthetic onToolStart indicator
        tool_calls: [{ id: 'tmp-create_table', type: 'function', function: { name: 'create_table', arguments: '{}' } }],
      }),
      msg({ role: 'tool', content: '{"table_id":"tbl1"}', tool_call_id: 'call_1' }),
      msg({ role: 'assistant', content: '建好了' }),
      msg({ role: 'user', content: '修改第一列为问题描述' }),
    ]

    const out = buildApiHistory(history)

    // Every assistant message with tool_calls must be immediately followed by a tool
    // message for each of its tool_call_ids (the exact rule DeepSeek enforces).
    for (let i = 0; i < out.length; i++) {
      const m = out[i] as ChatCompletionMessageParam & { tool_calls?: Array<{ id: string }> }
      if (m.role === 'assistant' && m.tool_calls?.length) {
        const following = out.slice(i + 1, i + 1 + m.tool_calls.length)
        expect(following.every((f) => f.role === 'tool')).toBe(true)
        const ids = new Set(following.map((f) => (f as { tool_call_id: string }).tool_call_id))
        for (const tc of m.tool_calls) expect(ids.has(tc.id)).toBe(true)
      }
    }

    // The tmp placeholder must not survive as an assistant-with-tool_calls.
    const toolCallIds = out.flatMap((m) =>
      (m as { tool_calls?: Array<{ id: string }> }).tool_calls?.map((t) => t.id) ?? []
    )
    expect(toolCallIds).toEqual(['call_1'])

    // No orphan tool messages.
    const respondedIds = new Set(
      out.filter((m) => m.role === 'tool').map((m) => (m as { tool_call_id: string }).tool_call_id)
    )
    expect([...respondedIds]).toEqual(['call_1'])
  })

  it('passes through a plain user/assistant conversation unchanged', () => {
    const out = buildApiHistory([
      msg({ role: 'user', content: 'hi' }),
      msg({ role: 'assistant', content: 'hello' }),
    ])
    expect(out).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ])
  })
})

describe('assertApiCallAllowed — feishu_api_call security gate', () => {
  it('allows business namespaces (bitable/sheets/docx/drive files/wiki)', () => {
    expect(() => assertApiCallAllowed('/bitable/v1/apps/x/tables')).not.toThrow()
    expect(() => assertApiCallAllowed('/sheets/v3/spreadsheets/x')).not.toThrow()
    expect(() => assertApiCallAllowed('/docx/v1/documents/x/blocks/x/children')).not.toThrow()
    expect(() => assertApiCallAllowed('/drive/v1/files/x/comments')).not.toThrow()
    expect(() => assertApiCallAllowed('/wiki/v2/spaces/get_node')).not.toThrow()
  })

  it('blocks messaging / contacts / admin / permissions / ownership transfer', () => {
    expect(() => assertApiCallAllowed('/im/v1/messages')).toThrow(/安全/)
    expect(() => assertApiCallAllowed('/contact/v3/users')).toThrow(/安全/)
    expect(() => assertApiCallAllowed('/drive/v1/permissions/x/members/transfer_owner')).toThrow(/安全/)
    expect(() => assertApiCallAllowed('/admin/v1/x')).toThrow(/安全/)
  })

  it('default-denies anything outside the allowlist', () => {
    expect(() => assertApiCallAllowed('/approval/v4/instances')).toThrow(/白名单/)
    expect(() => assertApiCallAllowed('/calendar/v4/calendars')).toThrow(/白名单/)
  })

  it('rejects path traversal / injection characters', () => {
    expect(() => assertApiCallAllowed('/bitable/../im/v1/messages')).toThrow()
    expect(() => assertApiCallAllowed('/bitable//evil')).toThrow()
    expect(() => assertApiCallAllowed('bitable/no-slash')).toThrow(/必须以/)
  })
})

describe('isFileLevelDelete — assistant never deletes whole files (principle 2)', () => {
  it('blocks whole-container tools (delete_table / delete_sheet)', () => {
    expect(isFileLevelDelete('delete_table', {})).toBe(true)
    expect(isFileLevelDelete('delete_sheet', {})).toBe(true)
  })

  it('blocks every DELETE through the generic API', () => {
    expect(isFileLevelDelete('feishu_api_call', { method: 'DELETE', path: '/drive/v1/files/x' })).toBe(true)
    expect(isFileLevelDelete('feishu_api_call', { method: 'delete', path: '/docx/v1/documents/x' })).toBe(true)
  })

  it('allows content-level deletion (rows / fields / blocks / dedupe) — gated by confirm, not blocked', () => {
    expect(isFileLevelDelete('delete_record', {})).toBe(false)
    expect(isFileLevelDelete('batch_delete_records', {})).toBe(false)
    expect(isFileLevelDelete('delete_field', {})).toBe(false)
    expect(isFileLevelDelete('delete_document_blocks', {})).toBe(false)
    expect(isFileLevelDelete('dedupe_records', {})).toBe(false)
  })

  it('does not block generic-API modifications (PUT/PATCH/GET)', () => {
    expect(isFileLevelDelete('feishu_api_call', { method: 'PATCH' })).toBe(false)
    expect(isFileLevelDelete('feishu_api_call', { method: 'PUT' })).toBe(false)
    expect(isFileLevelDelete('feishu_api_call', { method: 'GET' })).toBe(false)
  })
})

describe('describeDestructiveOp — confirm-card summary (button confirm)', () => {
  it('summarizes each content-delete tool readably', () => {
    expect(describeDestructiveOp('delete_record', {})).toMatch(/删除 1 条记录/)
    expect(describeDestructiveOp('batch_delete_records', { record_ids: ['a', 'b', 'c'] })).toMatch(/批量删除 3 条/)
    expect(describeDestructiveOp('delete_field', { field_name: '工时' })).toMatch(/工时/)
    // The tool deletes the half-open range [start_index, end_index) — count = end - start.
    expect(describeDestructiveOp('delete_document_blocks', { start_index: 2, end_index: 4 })).toMatch(/2 个内容块/)
    expect(describeDestructiveOp('dedupe_records', {})).toMatch(/去重/)
  })
  it('describes a generic write API call with its method + path', () => {
    expect(describeDestructiveOp('feishu_api_call', { method: 'PATCH', path: '/docx/v1/x' })).toMatch(/PATCH.*\/docx\/v1\/x/)
  })
  it('falls back gracefully for unknown counts / tools', () => {
    expect(describeDestructiveOp('batch_delete_records', {})).toMatch(/若干/)
    expect(describeDestructiveOp('mystery_tool', {})).toMatch(/mystery_tool/)
  })
})

describe('runAgent — cancellation (H3)', () => {
  it('an already-aborted signal bails before any model/network call', async () => {
    const ac = new AbortController()
    ac.abort()
    let chunks = 0
    const callbacks: AgentCallbacks = {
      onChunk: () => { chunks++ },
      onToolStart: () => {},
      onToolEnd: () => {},
      onAssistantMessage: () => {},
      onToolMessage: () => {},
    }
    const history: ChatMessage[] = [{ id: '1', role: 'user', content: 'hi', createdAt: 0 }]
    const settings = { openaiBaseUrl: 'https://api.invalid/v1', openaiApiKey: 'sk-x', openaiModel: 'm' } as AppSettings
    const context = { url: 'https://example.com' } as PageContext

    await expect(
      runAgent(history, settings, context, callbacks, undefined, ac.signal),
    ).rejects.toThrow(/abort/i)
    expect(chunks).toBe(0) // never reached the model
  })
})
