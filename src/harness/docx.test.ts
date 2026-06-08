/**
 * Live verification of the Docs (docx) tools — drives the real agent dispatch
 * (executeTool → executeDocTool → docx.ts → Feishu API).
 *
 * Skipped unless DOCX_LIVE=1. Needs the app to have `docx:document` (应用身份).
 * Run: DOCX_LIVE=1 npx vitest run src/harness/docx.test.ts --reporter=verbose
 */
import { describe, it, expect } from 'vitest'
import { tenantToken } from './driver'
import { executeTool } from '../shared/ai/agent'
import type { PageContext } from '../shared/types'

const LIVE = process.env.DOCX_LIVE === '1'

describe.runIf(LIVE)('document tools (live)', () => {
  const ctx: PageContext = { url: '', title: '', selectedText: '' }
  let token: string
  let docId: string
  const call = (name: string, args: Record<string, unknown>) => executeTool(name, args, token, ctx)

  it('create_document', async () => {
    token = await tenantToken()
    const r = (await call('create_document', { title: `自测文档_${process.pid}` })) as {
      document?: { document_id?: string }
    }
    docId = r.document!.document_id!
    expect(docId).toBeTruthy()
    console.log('document_id=', docId)
  }, 30_000)

  it('add_document_content inserts heading + paragraph + bullet', async () => {
    await call('add_document_content', {
      document_id: docId,
      blocks: [
        { text: '项目周报', style: 'h1' },
        { text: '本周完成了电子表格与文档能力的接入。', style: 'text' },
        { text: '电子表格 8 个接口已验证', style: 'bullet' },
      ],
    })
    const r = (await call('get_document_content', { document_id: docId })) as { content?: string }
    console.log('raw content:', JSON.stringify(r.content))
    expect(r.content).toContain('项目周报')
    expect(r.content).toContain('电子表格')
  }, 30_000)

  it('list_blocks shows the inserted blocks', async () => {
    const r = (await call('list_blocks', { document_id: docId })) as { items?: unknown[] }
    console.log('block count:', r.items?.length)
    expect((r.items?.length ?? 0)).toBeGreaterThanOrEqual(4) // page block + 3 inserted
  }, 30_000)

  it('create_doc_from_markdown builds a formatted doc', async () => {
    const md = [
      '# 项目周报',
      '本周完成 **电子表格** 与文档能力接入。',
      '## 进展',
      '- 电子表格 8 接口',
      '- 文档 markdown 生成',
      '1. 先验证端点',
      '2. 再实现',
      '> 全程实测，不靠猜。',
      '```',
      'print("hello")',
      '```',
      '---',
      '- [ ] 待办：补图表能力',
    ].join('\n')
    const r = (await call('create_doc_from_markdown', { title: 'MD周报', markdown: md })) as {
      document?: { document_id?: string }; blocks_inserted?: number
    }
    const id = r.document!.document_id!
    console.log('md doc:', id, 'blocks_inserted=', r.blocks_inserted)
    const content = (await call('get_document_content', { document_id: id })) as { content?: string }
    console.log('content:', JSON.stringify(content.content))
    expect(content.content).toContain('项目周报')
    expect(content.content).toContain('电子表格')
    expect(content.content).toContain('全程实测')
    expect(content.content).toContain('print("hello")')
    expect(r.blocks_inserted).toBeGreaterThanOrEqual(10)
  }, 30_000)

  it('insert_table fills a table with content', async () => {
    const r = (await call('insert_table', {
      document_id: docId,
      data: [['姓名', '分数'], ['张三', '90'], ['李四', '85']],
    })) as { table_block_id?: string; rows?: number; cols?: number }
    console.log('table:', JSON.stringify(r))
    expect(r.rows).toBe(3)
    expect(r.cols).toBe(2)
    const content = (await call('get_document_content', { document_id: docId })) as { content?: string }
    expect(content.content).toContain('姓名')
    expect(content.content).toContain('张三')
    expect(content.content).toContain('85')
  }, 40_000)

  it('delete_document_blocks removes the inserted range', async () => {
    await call('delete_document_blocks', {
      document_id: docId, parent_block_id: docId, start_index: 0, end_index: 3,
    })
    const r = (await call('get_document_content', { document_id: docId })) as { content?: string }
    expect(r.content ?? '').not.toContain('项目周报')
  }, 30_000)
})
