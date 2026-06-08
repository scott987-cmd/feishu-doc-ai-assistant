import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadVizList, saveViz, deleteViz } from './store'
import type { SavedViz } from './types'

let store: Record<string, unknown>
beforeEach(() => {
  store = {}
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: {
      get: (_keys: string[], cb: (r: Record<string, unknown>) => void) => cb(store),
      set: (obj: Record<string, unknown>, cb?: () => void) => { Object.assign(store, obj); cb?.() },
    } },
  }
})
afterEach(() => { delete (globalThis as { chrome?: unknown }).chrome })

const mk = (id: string, name = 'V' + id): SavedViz =>
  ({ id, name, source: { kind: 'base', appToken: 'app', tableId: 'tbl' }, code: 'chart.setOption({})', createdAt: 1 })

describe('dataviz store', () => {
  it('saves and loads', async () => {
    await saveViz(mk('1'))
    expect((await loadVizList()).map((v) => v.id)).toEqual(['1'])
  })

  it('dedups by id (update keeps position-prepend, newest first)', async () => {
    await saveViz(mk('1'))
    await saveViz(mk('2'))
    await saveViz(mk('1', 'updated'))
    const list = await loadVizList()
    expect(list.map((v) => v.id)).toEqual(['1', '2'])
    expect(list[0].name).toBe('updated')
  })

  it('deletes by id', async () => {
    await saveViz(mk('1'))
    await saveViz(mk('2'))
    await deleteViz('1')
    expect((await loadVizList()).map((v) => v.id)).toEqual(['2'])
  })
})
