import { describe, it, expect } from 'vitest'
import { runReplication, freshBase, readStructure } from './driver'

const LIVE = process.env.REPLICATE_LIVE === '1'

describe.runIf(LIVE)('harness smoke', () => {
  it('agent replicates a simple project-management table', async () => {
    const appToken = await freshBase('smoke')
    const prompt =
      '帮我在当前多维表格里创建一个「任务管理」数据表，包含这些字段：' +
      '任务名称（文本）、负责人（文本）、状态（单选：待办/进行中/已完成）、' +
      '优先级（单选：高/中/低）、截止日期（日期）、完成进度（数字）。'
    const res = await runReplication(prompt, appToken)

    console.log('--- final ---\n' + res.finalText)
    console.log('--- tools ---')
    for (const t of res.tools) {
      console.log(`${t.isError ? '✗' : '✓'} ${t.name}(${JSON.stringify(t.args).slice(0, 120)})` +
        (t.isError ? `  ERR: ${t.result?.slice(0, 160)}` : ''))
    }
    const struct = await readStructure(appToken)
    console.log('--- structure ---\n' + JSON.stringify(struct, null, 2))

    expect(res.errors.length).toBe(0)
    expect(struct.tables.length).toBeGreaterThanOrEqual(1)
  }, 120_000)
})
