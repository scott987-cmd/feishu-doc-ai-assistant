import { describe, it, expect } from 'vitest'
import { safeHttpUrl, safeImageSrc } from './url'

describe('safeHttpUrl / safeImageSrc — untrusted URL guard (M4)', () => {
  it('allows http(s) URLs (trimmed)', () => {
    expect(safeHttpUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png')
    expect(safeHttpUrl('  http://example.com/x  ')).toBe('http://example.com/x')
  })

  it('blocks javascript: / data: / file: and other schemes', () => {
    expect(safeImageSrc('javascript:alert(1)')).toBeNull()
    expect(safeImageSrc('data:image/svg+xml,<svg onload=alert(1)>')).toBeNull()
    expect(safeImageSrc('file:///etc/passwd')).toBeNull()
    expect(safeImageSrc('vbscript:msgbox')).toBeNull()
  })

  it('returns null for non-strings / empty', () => {
    expect(safeImageSrc(undefined)).toBeNull()
    expect(safeImageSrc(null)).toBeNull()
    expect(safeImageSrc(123)).toBeNull()
    expect(safeImageSrc('')).toBeNull()
  })
})
