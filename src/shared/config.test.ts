import { describe, it, expect } from 'vitest'
import { isFeishuOutboundAllowed, FEISHU_API_BASE, FEISHU_AUTHORIZE_URL, FEISHU_HOST_PATTERN } from './config'

// Default test env → base domain feishu.cn.
describe('isFeishuOutboundAllowed — code-layer outbound allowlist', () => {
  it('allows the base domain and any of its subdomains (open/accounts/tenant…)', () => {
    expect(isFeishuOutboundAllowed('https://open.feishu.cn/open-apis/x')).toBe(true)
    expect(isFeishuOutboundAllowed('https://accounts.feishu.cn/y')).toBe(true)
    expect(isFeishuOutboundAllowed('https://acme.feishu.cn/base/x')).toBe(true)
    expect(isFeishuOutboundAllowed('https://feishu.cn/z')).toBe(true)
  })

  it('rejects other hosts and look-alikes (suffix-spoofing)', () => {
    expect(isFeishuOutboundAllowed('https://evil.com/x')).toBe(false)
    expect(isFeishuOutboundAllowed('https://feishu.cn.evil.com/x')).toBe(false) // not a subdomain
    expect(isFeishuOutboundAllowed('https://notfeishu.cn/x')).toBe(false)       // no dot boundary
    expect(isFeishuOutboundAllowed('http://localhost/x')).toBe(false)
    expect(isFeishuOutboundAllowed('not a url')).toBe(false)
  })

  it('derives every endpoint from the one base domain', () => {
    expect(FEISHU_API_BASE).toBe('https://open.feishu.cn/open-apis')
    expect(FEISHU_AUTHORIZE_URL).toContain('accounts.feishu.cn')
    expect(FEISHU_HOST_PATTERN).toBe('*.feishu.cn')
  })
})
