import { describe, it, expect } from 'vitest'
import { deriveAccent, hexToRgb, ACCENT_VAR_NAMES, DEFAULT_ACCENT } from './theme'

describe('deriveAccent', () => {
  it('produces every brand variable for light and dark', () => {
    const light = deriveAccent('#4f6bff', false)
    const dark = deriveAccent('#4f6bff', true)
    for (const name of ACCENT_VAR_NAMES) {
      expect(light[name], `light ${name}`).toBeTruthy()
      expect(dark[name], `dark ${name}`).toBeTruthy()
    }
  })

  it('emits valid hex for the core primary', () => {
    expect(deriveAccent('#10b981', false)['--color-primary']).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('brightens the primary in dark mode', () => {
    const lum = (hex: string) => {
      const [r, g, b] = hexToRgb(hex)
      return 0.299 * r + 0.587 * g + 0.114 * b
    }
    const light = deriveAccent('#4f6bff', false)['--color-primary']
    const dark = deriveAccent('#4f6bff', true)['--color-primary']
    expect(lum(dark)).toBeGreaterThan(lum(light))
  })

  it('builds a two-stop linear-gradient for the brand', () => {
    expect(deriveAccent(DEFAULT_ACCENT, false)['--gradient-brand']).toMatch(
      /^linear-gradient\(135deg, #[0-9a-f]{6} 0%, #[0-9a-f]{6} 100%\)$/i
    )
  })

  it('expands 3-digit hex', () => {
    expect(hexToRgb('#fff')).toEqual([255, 255, 255])
  })
})
