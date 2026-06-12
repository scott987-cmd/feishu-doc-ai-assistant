import { describe, it, expect, vi, beforeEach } from 'vitest'
import { formatSkills, reportSkill, matchSkills, preloadSkills } from './skills'

describe('skills client — disabled (no proxy) is a TOTAL no-op (store release unaffected)', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  it('makes NO network call and returns empty when HAS_SKILLS is false', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    await reportSkill({ resourceKind: 'base', intent: 'x', toolSequence: ['a'], outcome: 'success' })
    expect(await matchSkills({ resourceKind: 'base', intent: 'x' })).toEqual([])
    expect(await preloadSkills('base')).toEqual([])
    expect(f).not.toHaveBeenCalled() // tests have no proxy → HAS_SKILLS false → never touches the network
  })
})

describe('formatSkills', () => {
  it('renders recipes + playbooks as one de-identified hint block', () => {
    const out = formatSkills([
      { skillId: '1', level: 'recipe', resourceKind: 'base', intent: '按分类字段求和做柱状图', toolSequence: ['list_fields', 'render_data_app'], lesson: '先读字段再聚合', score: 9 },
      { skillId: '2', level: 'playbook', resourceKind: 'base', intent: '做销售看板', toolSequence: ['search_records'], lesson: 'KPI+图表+明细', score: 8 },
    ])
    expect(out).toContain('社区沉淀')
    expect(out).toContain('【套路】做销售看板')
    expect(out).toContain('list_fields → render_data_app')
  })
  it('is empty when there are no skills', () => { expect(formatSkills([])).toBe('') })
})
