/**
 * Live verification of base_to_doc_report (Base → 汇总文档).
 * Needs bitable:app + docx:document. Run: DOCX_LIVE=1 npx vitest run src/harness/report.test.ts
 */
import { describe, it, expect } from 'vitest'
import { tenantToken, freshBase } from './driver'
import { executeTool } from '../shared/ai/agent'
import type { PageContext } from '../shared/types'

const LIVE = process.env.DOCX_LIVE === '1'

describe.runIf(LIVE)('base_to_doc_report (live)', () => {
  it('reads a Base and produces a summary document', async () => {
    const token = await tenantToken()
    const ctx: PageContext = { url: '', title: '', selectedText: '' }
    const call = (name: string, args: Record<string, unknown>) => executeTool(name, args, token, ctx)

    const appToken = await freshBase('report')
    await call('create_table', {
      app_token: appToken, table_name: '销售台账',
      fields: [{ field_name: '产品', type: 1 }, { field_name: '金额', type: 2 }],
    })

    const r = (await call('base_to_doc_report', { app_token: appToken, title: '经营汇总报告' })) as {
      document?: { document_id?: string }
    }
    const docId = r.document!.document_id!
    const content = (await call('get_document_content', { document_id: docId })) as { content?: string }
    console.log('report content:', JSON.stringify(content.content))
    expect(content.content).toContain('经营汇总报告')
    expect(content.content).toContain('销售台账')
    expect(content.content).toContain('记录数')
  }, 60_000)
})
