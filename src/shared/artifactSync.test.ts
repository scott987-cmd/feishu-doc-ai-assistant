import { describe, it, expect, vi, beforeEach } from 'vitest'
import { scheduleBackup, restoreArtifacts, restoreAndMerge } from './artifactSync'

// Tests run with no proxy configured → HAS_ARTIFACT_SYNC is false → every function must be a
// TOTAL no-op (no network, no storage writes). This is the guarantee that the store/BYO release
// is completely unaffected by the cloud-backup feature.
describe('artifactSync — disabled (no proxy) is a TOTAL no-op (store release unaffected)', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('scheduleBackup + restoreArtifacts make NO network call when HAS_ARTIFACT_SYNC is false', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    scheduleBackup('dataviz', [{ id: '1' }])
    scheduleBackup('slides', [{ id: '2' }])
    expect(await restoreArtifacts('dataviz')).toEqual([])
    expect(await restoreArtifacts('slides')).toEqual([])
    expect(f).not.toHaveBeenCalled()
  })

  it('restoreAndMerge returns 0 and never touches local storage when disabled', async () => {
    const load = vi.fn(async () => [{ id: 'a', createdAt: 1 }])
    const replace = vi.fn(async () => undefined)
    const n = await restoreAndMerge('dataviz', load, replace)
    expect(n).toBe(0)
    expect(load).not.toHaveBeenCalled()  // returns before loading
    expect(replace).not.toHaveBeenCalled()
  })
})
