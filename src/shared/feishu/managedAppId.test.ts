import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getManagedAppId } from './managedAppId'

// Tests run with no proxy configured → HAS_MANAGED_APP_ID is false → the managed App ID fetch is a
// TOTAL no-op (returns '' immediately, no network). This is the store-safety guarantee: the App-ID
// -from-proxy feature never touches the network on the store/BYO build.
describe('managedAppId — disabled (no proxy) is a TOTAL no-op', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  it('returns empty and makes NO network call when HAS_MANAGED_APP_ID is false', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await getManagedAppId()).toBe('')
    expect(f).not.toHaveBeenCalled()
  })
})
