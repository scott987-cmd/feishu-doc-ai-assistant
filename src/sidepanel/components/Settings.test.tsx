// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { probeLlm } from '../../shared/ai/llmProbe'
import Settings from './Settings'

vi.mock('../../shared/ai/llmProbe', () => ({
  probeLlm: vi.fn(async () => ({ ok: false, msg: '连不上 api.deepseek.com。请检查：① Base URL 的域名是否写对' })),
}))

afterEach(cleanup)

function renderSettings(overrides: Partial<Parameters<typeof Settings>[0]> = {}) {
  const props = {
    settings: { ...DEFAULT_SETTINGS },
    accent: '#4f6bff',
    onAccentChange: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  }
  return { ...render(<Settings {...props} />), props }
}

describe('Settings — LLM provider preset', () => {
  it('defaults Base URL to DeepSeek', () => {
    const { container } = renderSettings()
    const url = container.querySelector('input[type="url"]') as HTMLInputElement
    expect(url.value).toBe('https://api.deepseek.com')
  })

  it('picking 通义千问 fills its Base URL', () => {
    const { container } = renderSettings()
    const selects = [...container.querySelectorAll('select')]
    const provider = selects.find((s) => [...s.options].some((o) => o.value === 'qwen'))!
    fireEvent.change(provider, { target: { value: 'qwen' } })
    const url = container.querySelector('input[type="url"]') as HTMLInputElement
    expect(url.value).toContain('dashscope')
  })

  it('model field is free-text (input, not locked select)', () => {
    const { container } = renderSettings()
    // Model is an <input list=model-suggestions>, so any latest id can be typed
    expect(container.querySelector('input[list="model-suggestions"]')).toBeTruthy()
  })
})

describe('Settings — appearance accent', () => {
  it('clicking a swatch calls onAccentChange with a hex', () => {
    const onAccentChange = vi.fn()
    const { container } = renderSettings({ onAccentChange })
    const swatches = container.querySelectorAll('.accent-swatch')
    expect(swatches.length).toBeGreaterThan(1)
    fireEvent.click(swatches[1])
    expect(onAccentChange).toHaveBeenCalledOnce()
    expect(onAccentChange.mock.calls[0][0]).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe('Settings — 测试模型连接', () => {
  it('probes the LLM config currently in the form and shows the diagnosis', async () => {
    const { getByText, findByText } = renderSettings()
    fireEvent.click(getByText('测试模型连接'))
    expect(await findByText(/连不上 api\.deepseek\.com/)).toBeTruthy()
    expect(probeLlm).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: 'https://api.deepseek.com' }))
  })

  it('drops a stale result once the endpoint is edited', async () => {
    const { container, getByText, findByText, queryByText } = renderSettings()
    fireEvent.click(getByText('测试模型连接'))
    await findByText(/连不上/)
    fireEvent.change(container.querySelector('input[type="url"]')!, { target: { value: 'https://api.moonshot.cn/v1' } })
    expect(queryByText(/连不上/)).toBeNull()
  })

  it('ignores a probe that finishes after the endpoint was edited mid-test', async () => {
    let finish!: (r: { ok: boolean; msg: string }) => void
    vi.mocked(probeLlm).mockImplementationOnce(() => new Promise((r) => { finish = r }))
    const { container, getByText, findByText, queryByText } = renderSettings()
    fireEvent.click(getByText('测试模型连接'))
    await findByText('测试中…')
    fireEvent.change(container.querySelector('input[type="url"]')!, { target: { value: 'https://api.moonshot.cn/v1' } })
    finish({ ok: false, msg: '连不上 api.deepseek.com（旧地址）' })
    await findByText('测试模型连接') // probe settled, button re-enabled
    expect(queryByText(/旧地址/)).toBeNull()
  })
})
