import { describe, it, expect, vi } from 'vitest'

vi.mock('../config', () => ({ BUILD_CONFIG: { llmRedact: true, llmMaxPayloadChars: 24 } }))

import { redactSensitive, capPayload, sanitizeForLlm } from './redact'

describe('redact — 外发脱敏 + 上限（已开启）', () => {
  it('掩盖手机号 / 邮箱 / 身份证', () => {
    const out = redactSensitive('联系 13800138000，邮箱 a.b@x.com，证件 11010119900307123X')
    expect(out).not.toMatch(/13800138000|a\.b@x\.com|11010119900307123X/)
    expect(out).toContain('[手机]')
    expect(out).toContain('[邮箱]')
    expect(out).toContain('[身份证]')
  })
  it('掩盖带 +86 前缀的手机号', () => {
    expect(redactSensitive('电话 +8613800138000')).toBe('电话 [手机]')
    expect(redactSensitive('电话 8613800138000')).toBe('电话 [手机]')
  })
  it('不误伤普通数字/文本（含 16~19 位长数字，如订单号）', () => {
    expect(redactSensitive('数量 12345，价格 99.5')).toBe('数量 12345，价格 99.5')
    expect(redactSensitive('订单 1234567890123456')).toBe('订单 1234567890123456') // 不再误判为卡号
  })
  it('capPayload 截断超出上限的载荷', () => {
    const out = capPayload('x'.repeat(50))
    expect(out.startsWith('x'.repeat(24))).toBe(true)
    expect(out).toContain('已截断')
  })
  it('sanitizeForLlm = 脱敏 + 截断', () => {
    expect(sanitizeForLlm('13800138000')).toBe('[手机]')
  })
})
