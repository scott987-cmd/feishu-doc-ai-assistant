import { describe, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { runReplication, freshBase, readStructure, tenantToken } from './driver'
import * as API from '../shared/feishu/api'

const LIVE = process.env.REPLICATE_LIVE === '1'

/**
 * "Hard mode" replication: a real marketplace template isn't just a schema — it has
 * a FORMULA field, SAMPLE rows, and an extra VIEW. This probes whether the agent +
 * our tools can do a *full* replication, surfacing gaps (e.g. formula field support).
 */
describe.runIf(LIVE)('rich replication probe', () => {
  it('销售订单: 公式字段 + 示例数据 + 看板视图', async () => {
    const appToken = await freshBase('rich-order')
    const prompt =
      '在当前多维表格里完整复刻一个「销售订单」模板，要求：\n' +
      '1) 创建数据表「销售订单」，字段：订单编号(文本)、客户名称(文本)、产品(文本)、' +
      '数量(数字)、单价(数字)、订单金额(公式：数量×单价)、订单状态(单选：待付款/已付款/已发货/已完成)、下单日期(日期)。\n' +
      '2) 录入 4 条示例订单数据。\n' +
      '3) 再创建一个按「订单状态」分组的看板视图。'
    const res = await runReplication(prompt, appToken)
    const struct = await readStructure(appToken)
    const token = await tenantToken()

    // locate the order table
    const tablesRes = (await API.listTables(token, appToken)) as { items: Array<{ table_id: string; name: string }> }
    const orderTbl = tablesRes.items.find((t) => t.name.includes('订单')) ?? tablesRes.items[tablesRes.items.length - 1]
    const records = (await API.listRecords(token, appToken, orderTbl.table_id, 100)) as { items?: unknown[] }
    const views = (await API.listViews(token, appToken, orderTbl.table_id)) as { items?: Array<{ view_type: string }> }
    const fields = struct.tables.find((t) => t.name.includes('订单'))?.fields ?? []
    const formulaField = fields.find((f) => f.type === 20)

    // Inspect the formula field's actual expression + whether records computed a value.
    const rawFields = (await API.listFields(token, appToken, orderTbl.table_id)) as {
      items: Array<{ field_name: string; type: number; property?: unknown }>
    }
    const fF = rawFields.items.find((f) => f.type === 20)
    const formulaExpr = JSON.stringify(fF?.property ?? null)
    const firstRec = (records.items?.[0] ?? {}) as { fields?: Record<string, unknown> }
    const amountVal = fF ? JSON.stringify(firstRec.fields?.[fF.field_name] ?? null) : 'n/a'

    const out = [
      '======= 销售订单 硬核复刻 =======',
      `工具调用: ${res.tools.length}  错误: ${res.errors.length}`,
      ...res.errors.map((e) => `  ✗ ${e.name}: ${e.result?.slice(0, 200)}`),
      `字段: ${fields.map((f) => `${f.name}(${f.type})`).join(', ')}`,
      `公式字段(type=20): ${formulaField ? formulaField.name : '❌ 无'}`,
      `  公式property: ${formulaExpr}`,
      `  首条记录金额值: ${amountVal}`,
      `示例记录数: ${records.items?.length ?? 0}`,
      `视图: ${(views.items ?? []).map((v) => v.view_type).join(', ')}  (看板=${(views.items ?? []).some((v) => v.view_type === 'kanban') ? '✓' : '❌'})`,
      '================================',
    ].join('\n')
    console.log('\n' + out + '\n')
    writeFileSync('harness-rich-report.txt', out + '\n')
  }, 180_000)
})
