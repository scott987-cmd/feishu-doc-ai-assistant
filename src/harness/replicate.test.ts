import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { runReplication, freshBase, readStructure, type ActualField } from './driver'
import { TEMPLATES, type TemplateSpec } from './templates'

const LIVE = process.env.REPLICATE_LIVE === '1'

const norm = (s: string) =>
  s.replace(/[\s（）()[\]【】_\-:：]/g, '')
    .replace(/[\p{Extended_Pictographic}]/gu, '')
    .toLowerCase()

const fieldMatch = (expName: string, actNames: string[]) => {
  const e = norm(expName)
  return actNames.some((a) => {
    const n = norm(a)
    return n.length > 0 && (n.includes(e) || e.includes(n))
  })
}

interface Report {
  key: string; label: string; coverage: number
  matched: number; total: number; missing: string[]
  selectIssues: string[]; toolErrors: string[]
}

async function scoreTemplate(t: TemplateSpec): Promise<Report> {
  const appToken = await freshBase(t.key)
  const res = await runReplication(t.prompt, appToken)
  const struct = await readStructure(appToken)

  // Pick the table that best covers the expected fields (handles new table or renamed default).
  let best: { name: string; fields: ActualField[] } = { name: '(none)', fields: [] }
  let bestScore = -1
  for (const tbl of struct.tables) {
    const names = tbl.fields.map((f) => f.name)
    const score = t.expect.filter((e) => fieldMatch(e.name, names)).length
    if (score > bestScore) { bestScore = score; best = tbl }
  }

  const actNames = best.fields.map((f) => f.name)
  const missing = t.expect.filter((e) => !fieldMatch(e.name, actNames)).map((e) => e.name)
  const matched = t.expect.length - missing.length

  const selectIssues: string[] = []
  for (const e of t.expect) {
    if (!e.select) continue
    const hit = best.fields.find((f) => { const n = norm(f.name), x = norm(e.name); return n.includes(x) || x.includes(n) })
    if (hit && hit.type !== e.select) {
      selectIssues.push(`${e.name}: 期望type=${e.select} 实际=${hit.type}`)
    }
  }

  return {
    key: t.key, label: t.label,
    coverage: matched / t.expect.length, matched, total: t.expect.length,
    missing, selectIssues,
    toolErrors: res.errors.map((er) => `${er.name}: ${er.result?.slice(0, 120)}`),
  }
}

describe.runIf(LIVE)('replicate 10 templates', () => {
  it('agent faithfully reproduces all 10', async () => {
    const reports: Report[] = []
    for (const t of TEMPLATES) {
      try {
        reports.push(await scoreTemplate(t))
      } catch (err) {
        reports.push({
          key: t.key, label: t.label, coverage: 0, matched: 0, total: t.expect.length,
          missing: t.expect.map((e) => e.name), selectIssues: [],
          toolErrors: [`THREW: ${err instanceof Error ? err.message : String(err)}`],
        })
      }
    }

    const lines: string[] = ['=========== 复刻结果汇总 ===========']
    for (const r of reports) {
      const pct = Math.round(r.coverage * 100)
      const ok = r.coverage === 1 && r.toolErrors.length === 0 && r.selectIssues.length === 0
      lines.push(`${ok ? '✅' : '⚠️ '} ${r.label.padEnd(12)} 字段 ${r.matched}/${r.total} (${pct}%)` +
        (r.missing.length ? ` | 缺: ${r.missing.join('、')}` : '') +
        (r.selectIssues.length ? ` | 类型: ${r.selectIssues.join('; ')}` : '') +
        (r.toolErrors.length ? ` | 工具错: ${r.toolErrors.join(' || ')}` : ''))
    }
    const fullyOk = reports.filter((r) => r.coverage === 1 && r.toolErrors.length === 0 && r.selectIssues.length === 0).length
    const avgCov = Math.round((reports.reduce((s, r) => s + r.coverage, 0) / reports.length) * 100)
    lines.push('-----------------------------------')
    lines.push(`完美复刻: ${fullyOk}/${reports.length}  |  平均字段覆盖: ${avgCov}%`)
    lines.push('===================================')
    const out = lines.join('\n')
    console.log('\n' + out + '\n')
    writeFileSync('harness-report.txt', out + '\n')

    // No hard tool errors anywhere; field coverage must average high.
    expect(reports.flatMap((r) => r.toolErrors)).toEqual([])
    expect(avgCov).toBeGreaterThanOrEqual(90)
  }, 600_000)
})
