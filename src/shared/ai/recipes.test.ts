import { describe, it, expect } from 'vitest'
import { bigrams, similarity, relevantRecipes, mergeRecipe, formatRecipes, type Recipe } from './recipes'

const rec = (id: string, kind: string, task: string, tools: string[], count = 1, ts = 0): Recipe =>
  ({ id, kind, task, tools, count, ts })

describe('recipes — similarity + recall', () => {
  it('similarity is high for near-identical CJK tasks, low for unrelated', () => {
    expect(similarity(bigrams('创建一个项目管理表格'), bigrams('创建项目管理表格'))).toBeGreaterThan(0.6)
    expect(similarity(bigrams('创建项目表格'), bigrams('删除文档评论'))).toBeLessThan(0.3)
  })

  it('relevantRecipes returns the most similar, kind-matched first', () => {
    const all = [
      rec('a', 'base', '创建项目管理表格', ['create_bitable_app', 'create_table']),
      rec('b', 'doc', '生成周报文档', ['create_doc_from_markdown']),
      rec('c', 'base', '统计销售数据', ['summarize_table']),
    ]
    const out = relevantRecipes(all, '帮我创建项目管理表格', 'base', 2)
    expect(out[0].id).toBe('a')
    expect(out.find((r) => r.id === 'b')).toBeUndefined() // unrelated doc recipe excluded
  })

  it('returns nothing when nothing is similar enough', () => {
    const all = [rec('a', 'base', '创建项目表格', ['create_table'])]
    expect(relevantRecipes(all, '今天天气如何', 'general')).toHaveLength(0)
  })
})

describe('recipes — merge / dedup / cap', () => {
  it('merges a recurring pattern (bumps count) instead of duplicating', () => {
    const all = [rec('a', 'base', '创建项目管理表格', ['create_table'], 1, 1)]
    const out = mergeRecipe(all, { kind: 'base', task: '创建项目管理表格', tools: ['create_table'] }, () => 'new', 100)
    expect(out).toHaveLength(1)
    expect(out[0].count).toBe(2)
    expect(out[0].ts).toBe(100)
  })

  it('adds a new recipe when the task differs', () => {
    const all = [rec('a', 'base', '创建项目表格', ['create_table'])]
    const out = mergeRecipe(all, { kind: 'doc', task: '生成周报', tools: ['create_doc_from_markdown'] }, () => 'new', 1)
    expect(out).toHaveLength(2)
  })

  it('caps to 300, keeping the most-used / most-recent', () => {
    const all = Array.from({ length: 300 }, (_, i) => rec(`r${i}`, 'base', `任务${i}`, ['t'], 1, i))
    const out = mergeRecipe(all, { kind: 'doc', task: '全新任务xyz', tools: ['t'] }, () => 'new', 999)
    expect(out).toHaveLength(300)
    expect(out.some((r) => r.id === 'new')).toBe(true) // newest kept
    expect(out.some((r) => r.id === 'r0')).toBe(false) // oldest/least dropped
  })
})

describe('recipes — distilled lessons', () => {
  it('stores the lesson on a new recipe and prefers it over the tool chain in the prompt', () => {
    const out = mergeRecipe([], { kind: 'base', task: '按地区汇总销量', tools: ['summarize_table'], lesson: '先分组再出图' }, () => 'x', 1)
    expect(out[0].lesson).toBe('先分组再出图')
    expect(formatRecipes(out)).toContain('先分组再出图')
  })

  it('keeps the prior lesson when a recurring pattern bumps without a new one', () => {
    const all = [rec('a', 'base', '按地区汇总销量', ['summarize_table'], 1, 1)]
    all[0].lesson = '先分组再出图'
    const out = mergeRecipe(all, { kind: 'base', task: '按地区汇总销量额', tools: ['summarize_table'] }, () => 'new', 2)
    expect(out).toHaveLength(1)
    expect(out[0].count).toBe(2)
    expect(out[0].lesson).toBe('先分组再出图') // retained
  })
})

describe('recipes — prompt formatting', () => {
  it('renders a hint block, empty string when none', () => {
    expect(formatRecipes([])).toBe('')
    const out = formatRecipes([rec('a', 'base', '创建项目表格', ['create_bitable_app', 'create_table'])])
    expect(out).toContain('创建项目表格')
    expect(out).toContain('create_bitable_app → create_table')
  })
})
