import { describe, it, expect, vi, afterEach } from 'vitest'
import { robustFetch } from './http'

afterEach(() => { vi.restoreAllMocks() })

describe('robustFetch — retry policy (prevents duplicate writes)', () => {
  it('does NOT retry writes (POST) — a timed-out create may have succeeded', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network down'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(robustFetch('https://x/y', {}, 'POST')).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1) // exactly once — never retried
  })

  it('does NOT retry DELETE / PUT / PATCH either', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('down'))
    vi.stubGlobal('fetch', fetchMock)
    for (const m of ['DELETE', 'PUT', 'PATCH']) {
      fetchMock.mockClear()
      await expect(robustFetch('https://x', {}, m)).rejects.toThrow()
      expect(fetchMock, m).toHaveBeenCalledTimes(1)
    }
  })

  it('retries idempotent reads (GET) up to 3 times then throws', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('flaky'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(robustFetch('https://x', {}, 'GET')).rejects.toThrow(/已重试 3 次/)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  }, 10_000)

  it('returns the first successful GET without extra attempts', async () => {
    const ok = { ok: true } as Response
    const fetchMock = vi.fn().mockResolvedValue(ok)
    vi.stubGlobal('fetch', fetchMock)
    expect(await robustFetch('https://x', {}, 'GET')).toBe(ok)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('passes an AbortSignal (timeout wiring)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response)
    vi.stubGlobal('fetch', fetchMock)
    await robustFetch('https://x', { method: 'GET' }, 'GET')
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })
})
