import { describe, it, expect } from 'vitest'
import { sanitizeSlides } from './slides'

describe('sanitizeSlides — coerce model output into safe, well-formed slides', () => {
  it('returns [] for non-array input', () => {
    expect(sanitizeSlides(null)).toEqual([])
    expect(sanitizeSlides({})).toEqual([])
    expect(sanitizeSlides('x')).toEqual([])
  })

  it('keeps a valid layout and defaults an unknown/missing one to bullets', () => {
    const out = sanitizeSlides([
      { layout: 'title', title: '封面', subtitle: '副标题' },
      { layout: 'made-up', title: '内容', bullets: ['a', 'b'] },
      { title: '无 layout', bullets: ['x'] },
    ])
    expect(out.map((s) => s.layout)).toEqual(['title', 'bullets', 'bullets'])
  })

  it('drops slides with no content at all', () => {
    const out = sanitizeSlides([
      { layout: 'bullets' },                 // empty → dropped
      { layout: 'bullets', bullets: [] },    // empty bullets → dropped
      { layout: 'section', title: '第一章' },// has a title → kept
    ])
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('第一章')
  })

  it('coerces bullets to a trimmed array of strings and skips blanks', () => {
    const out = sanitizeSlides([{ layout: 'bullets', title: 't', bullets: ['a', '', '  ', 'b', 123] }])
    expect(out[0].bullets).toEqual(['a', 'b', '123'])
  })

  it('normalizes stats entries to {num,label} strings', () => {
    const out = sanitizeSlides([{ layout: 'stats', title: 'KPI', stats: [{ num: 42, label: '用户' }, { num: '3x' }] }])
    expect(out[0].stats).toEqual([{ num: '42', label: '用户' }, { num: '3x', label: '' }])
  })

  it('caps the deck length and per-slide arrays', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ layout: 'bullets', title: `s${i}`, bullets: ['x'] }))
    expect(sanitizeSlides(many)).toHaveLength(40)
    const bigBullets = sanitizeSlides([{ layout: 'bullets', title: 't', bullets: Array.from({ length: 20 }, () => 'b') }])
    expect(bigBullets[0].bullets!.length).toBeLessThanOrEqual(12)
  })

  it('preserves two-col second column', () => {
    const out = sanitizeSlides([{ layout: 'two-col', title: '对比', bullets: ['优点'], bullets2: ['缺点'] }])
    expect(out[0].bullets).toEqual(['优点'])
    expect(out[0].bullets2).toEqual(['缺点'])
  })

  it('keeps a chart slide with its ECharts option object', () => {
    const opt = { series: [{ type: 'pie', data: [{ name: 'A', value: 3 }] }] }
    const out = sanitizeSlides([{ layout: 'chart', title: '占比', chart: opt }])
    expect(out).toHaveLength(1)
    expect(out[0].layout).toBe('chart')
    expect(out[0].chart).toEqual(opt)
  })

  it('drops a chart slide whose chart is missing or not an object', () => {
    const out = sanitizeSlides([
      { layout: 'chart' },                 // no chart, no other content → dropped
      { layout: 'chart', chart: 'nope' },  // chart not an object, no other content → dropped
    ])
    expect(out).toHaveLength(0)
  })

  it('keeps an embed slide with its render code string', () => {
    const out = sanitizeSlides([{ layout: 'embed', title: '看板', code: 'ui.dashboard(container,{data})' }])
    expect(out).toHaveLength(1)
    expect(out[0].layout).toBe('embed')
    expect(out[0].code).toContain('ui.dashboard')
  })
})
