import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { getTenantAccessToken } from '../shared/feishu/auth'
import { executeTemplate } from '../shared/templates/engine'
import type { ScenarioTemplate } from '../shared/templates/types'

const LIVE = process.env.FEISHU_LIVE === '1'

describe.runIf(LIVE)('HR template end-to-end (live)', () => {
  it('creates the 人员管理系统 without the DuplexLink error', async () => {
    const cfg = readFileSync('feishu-app-config.txt', 'utf8')
    const token = await getTenantAccessToken(
      cfg.match(/APP_ID\s*=\s*(\S+)/i)![1],
      cfg.match(/App_Secret\s*=\s*(\S+)/i)![1]
    )
    const tpl = JSON.parse(readFileSync('public/templates/hr.json', 'utf8')) as ScenarioTemplate
    const steps: string[] = []
    const result = await executeTemplate(tpl, { app_name: '自测_HR_可删' }, token, undefined, (s) => {
      for (const st of s) if (st.status === 'error') steps.push(`ERROR ${st.label}: ${st.detail}`)
    })
    expect(steps).toEqual([]) // no error steps
    expect(result.tables.length).toBe(2)
    expect(result.totalRecords).toBeGreaterThanOrEqual(6)
    console.log('created:', result.appName, result.appUrl)
  }, 120_000)
})
