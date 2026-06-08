import { describe, it, expect } from 'vitest'
import { tenantToken } from './driver'
import { executeTool } from '../shared/ai/agent'
import { DEFAULT_SETTINGS, type PageContext } from '../shared/types'

const LIVE = process.env.REPLICATE_LIVE === '1'
const OWNER = process.env.OWNER_OPEN_ID || ''

describe.runIf(LIVE && OWNER)('create_bitable_app auto-transfer', () => {
  it('new Base is transferred to the configured owner open_id', async () => {
    const token = await tenantToken()
    const ctx: PageContext = { url: '', title: '', selectedText: '' }
    const settings = { ...DEFAULT_SETTINGS, feishuOwnerOpenId: OWNER }

    const created = (await executeTool('create_bitable_app', { name: '自动转移验证' }, token, ctx, settings)) as {
      app?: { app_token?: string }
      _transfer_warning?: string
    }
    expect(created._transfer_warning).toBeUndefined()
    const appToken = created.app!.app_token!

    const members = await (await fetch(
      `https://open.feishu.cn/open-apis/drive/v1/permissions/${appToken}/members?type=bitable`,
      { headers: { Authorization: `Bearer ${token}` } },
    )).json()
    const items: Array<{ member_id?: string; perm?: string }> = members.data?.items ?? []
    console.log('members:', JSON.stringify(items.map((m) => ({ id: m.member_id?.slice(0, 12), perm: m.perm }))))
    console.log('base url: https://acme.feishu.cn/base/' + appToken)

    const hit = items.find((m) => m.member_id === OWNER && m.perm === 'full_access')
    expect(hit, '配置的 open_id 应作为 full_access 出现在协作者中').toBeTruthy()
  }, 60_000)
})
