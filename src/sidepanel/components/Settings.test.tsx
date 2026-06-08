// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '../../shared/types'
import Settings from './Settings'

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
