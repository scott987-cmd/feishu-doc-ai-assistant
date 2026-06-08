/**
 * Accent (brand) color theming. The default UI ships a hand-tuned indigo→violet
 * palette in App.css; when a user picks a custom accent we derive the full set of
 * brand CSS variables (light + dark variants) from a single hex and write them onto
 * :root at runtime — same "set root var + persist to localStorage" pattern as the
 * light/dark theme toggle (key: fa-accent).
 */

export interface AccentPreset { name: string; hex: string }

// First entry MUST match App.css's default --color-primary so "default" means
// "use the polished CSS defaults" (App.tsx clears overrides for it).
export const ACCENT_PRESETS: AccentPreset[] = [
  { name: '靛蓝', hex: '#4f6bff' },
  { name: '紫罗兰', hex: '#7c5cff' },
  { name: '海蓝', hex: '#2f9bff' },
  { name: '青碧', hex: '#06b6d4' },
  { name: '翡翠', hex: '#10b981' },
  { name: '珊瑚', hex: '#f4654a' },
  { name: '玫紫', hex: '#e84393' },
]

export const DEFAULT_ACCENT = ACCENT_PRESETS[0].hex

// ─── Color helpers ─────────────────────────────────────────────────────────────

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((x) => Math.round(clamp(x, 0, 255)).toString(16).padStart(2, '0')).join('')
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const l = (max + min) / 2
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  return [h, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360
  s = clamp(s, 0, 1); l = clamp(l, 0, 1)
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

const hslHex = (h: number, s: number, l: number) => rgbToHex(...hslToRgb(h, s, l))

// ─── Derive the brand variable set from one accent hex ──────────────────────────

/**
 * Map a single accent hex to the full set of brand CSS variables for the given
 * mode. Mirrors the variables defined in App.css :root / [data-theme="dark"].
 */
export function deriveAccent(hex: string, isDark: boolean): Record<string, string> {
  const [h, s0, l0] = rgbToHsl(hexToRgb(hex))
  const s = clamp(s0, 0.45, 1) // keep custom colors vivid enough to read as "brand"

  // Core primary (text/icon accent). Brighten in dark mode for contrast.
  const pl = isDark ? clamp(l0 + 0.12, 0, 0.8) : l0
  const primary = hslHex(h, s, pl)
  const [pr, pg, pb] = hslToRgb(h, s, pl).map(Math.round)

  const hover = isDark ? hslHex(h, s, pl + 0.12) : hslHex(h, s, l0 - 0.1)
  const soft = isDark ? hslHex(h, clamp(s * 0.5, 0, 0.5), 0.18) : hslHex(h, clamp(s * 0.9, 0, 1), 0.95)
  const tint = isDark ? hslHex(h, clamp(s * 0.5, 0, 0.5), 0.2) : hslHex(h, clamp(s, 0, 1), 0.93)

  // Gradient: accent → a +30° hue-rotated companion (the signature indigo→violet feel).
  const gh = h + 30
  const gStart = isDark ? hslHex(h, s, l0 + 0.12) : hslHex(h, s, clamp(l0 + 0.04, 0, 0.7))
  const gEnd = isDark ? hslHex(gh, s, l0 + 0.1) : hslHex(gh, s, l0)
  const [sr, sg, sb] = hslToRgb(gh, s, l0).map(Math.round) // shadow color = gradient end

  return {
    '--color-primary': primary,
    '--color-primary-hover': hover,
    '--color-primary-soft': soft,
    '--color-primary-tint': tint,
    '--color-primary-border': `rgba(${pr}, ${pg}, ${pb}, .35)`,
    '--color-primary-border-soft': `rgba(${pr}, ${pg}, ${pb}, .14)`,
    '--gradient-brand': `linear-gradient(135deg, ${gStart} 0%, ${gEnd} 100%)`,
    '--gradient-brand-hover': `linear-gradient(135deg, ${primary} 0%, ${hslHex(gh, s, l0 - 0.04)} 100%)`,
    '--ring': `0 0 0 3px rgba(${pr}, ${pg}, ${pb}, .18)`,
    '--shadow-brand-sm': `0 3px 10px rgba(${sr}, ${sg}, ${sb}, .28)`,
    '--shadow-brand-sm-hover': `0 5px 14px rgba(${sr}, ${sg}, ${sb}, .4)`,
    '--shadow-brand': `0 6px 18px rgba(${sr}, ${sg}, ${sb}, .32)`,
    '--shadow-brand-hover': `0 9px 24px rgba(${sr}, ${sg}, ${sb}, .44)`,
    '--shadow-brand-lg': `0 10px 28px rgba(${sr}, ${sg}, ${sb}, .38)`,
    '--shadow-brand-bubble': `0 4px 14px rgba(${sr}, ${sg}, ${sb}, .28)`,
  }
}

export const ACCENT_VAR_NAMES = Object.keys(deriveAccent(DEFAULT_ACCENT, false))

/**
 * Accent for the data-viz overlay (PPT / 网站 / 看板 / 图表). The sandbox design system uses
 * --p / --p-strong / --p-soft (not the panel's --color-primary set), so map an accent hex →
 * those three + a harmonious chart color palette, mode-aware. Leads the palette with the accent
 * itself so charts read as branded.
 */
export function vizAccent(hex: string, isDark: boolean): { p: string; strong: string; soft: string; palette: string[] } {
  const [h, s0, l0] = rgbToHsl(hexToRgb(hex))
  const s = clamp(s0, 0.45, 1)
  const p = isDark ? hslHex(h, s, clamp(l0 + 0.12, 0.4, 0.82)) : hslHex(h, s, clamp(l0, 0.3, 0.66))
  const strong = isDark ? hslHex(h, s, clamp(l0 + 0.22, 0.5, 0.9)) : hslHex(h, s, clamp(l0 - 0.08, 0.24, 0.6))
  const soft = isDark ? hslHex(h, clamp(s * 0.5, 0, 0.5), 0.17) : hslHex(h, clamp(s * 0.9, 0, 1), 0.95)
  const offs = [0, 150, 60, 215, 30, 280, 110] // accent first, then harmonious hue-rotations
  const ss = clamp(s, 0.5, 0.85), sl = isDark ? 0.62 : 0.55
  const palette = offs.map((o, i) => (i === 0 ? p : hslHex((h + o) % 360, ss, sl)))
  return { p, strong, soft, palette }
}
