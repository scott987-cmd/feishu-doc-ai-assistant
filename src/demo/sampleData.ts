/**
 * Bundled sample dataset for Demo mode — lets a reviewer (or a first-time user) try the
 * AI dashboard / chart / slides features with NO Feishu login and NO real data. Only an LLM
 * key is needed (which, unlike a Feishu user_access_token, doesn't expire in ~2h).
 */
import type { VizData } from '../shared/dataviz/types'

export const SAMPLE_TITLE = '示例数据 · 季度销售'

export const SAMPLE_DATA: VizData = {
  schema: [
    { name: '月份', type: 'Text', samples: ['1月', '2月', '3月'] },
    { name: '区域', type: 'SingleSelect', samples: ['华东', '华南', '华北'] },
    { name: '产品', type: 'SingleSelect', samples: ['基础版', '专业版', '企业版'] },
    { name: '销售额', type: 'Number', samples: ['12000', '8600', '23000'] },
    { name: '订单数', type: 'Number', samples: ['34', '12', '8'] },
    { name: '状态', type: 'SingleSelect', samples: ['已完成', '进行中', '已逾期'] },
  ],
  rows: (() => {
    const months = ['1月', '2月', '3月', '4月', '5月', '6月']
    const regions = ['华东', '华南', '华北', '西南']
    const products = ['基础版', '专业版', '企业版']
    const states = ['已完成', '进行中', '已逾期']
    const rows: Record<string, string>[] = []
    let seed = 7
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    for (const m of months) for (const r of regions) {
      const p = products[Math.floor(rnd() * products.length)]
      const base = p === '企业版' ? 30000 : p === '专业版' ? 12000 : 5000
      rows.push({
        月份: m, 区域: r, 产品: p,
        销售额: String(Math.round(base * (0.6 + rnd() * 0.9))),
        订单数: String(2 + Math.floor(rnd() * 40)),
        状态: states[Math.floor(rnd() * states.length)],
      })
    }
    return rows
  })(),
}
