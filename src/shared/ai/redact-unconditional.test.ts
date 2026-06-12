import { describe, it, expect, vi } from 'vitest'

// llmRedact OFF — proves redactPII scrubs REGARDLESS of the VITE_LLM_REDACT flag (the skill-library
// payload's privacy promise is unconditional), while redactSensitive stays flag-gated.
vi.mock('../config', () => ({ BUILD_CONFIG: { llmRedact: false, llmMaxPayloadChars: 0 } }))

import { redactPII, redactSensitive } from './redact'

describe('redact — redactPII 无条件脱敏（与 VITE_LLM_REDACT 无关）', () => {
  it('开关关闭时：redactSensitive 不脱敏，但 redactPII 仍脱敏（技能外发的无条件承诺）', () => {
    const s = '把电话 13800138000、邮箱 a@b.com 改一下'
    expect(redactSensitive(s)).toBe(s)             // 受开关控制 → 关时原样返回
    const p = redactPII(s)
    expect(p).toContain('[手机]')                   // 无条件 → 始终脱敏
    expect(p).toContain('[邮箱]')
    expect(p).not.toMatch(/13800138000|a@b\.com/)
  })
})
