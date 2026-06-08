import { describe, it, expect, beforeEach } from 'vitest'
import { parseVersion, versionCandidates, rememberVersion, _resetVersionCache } from './version'

beforeEach(() => _resetVersionCache())

describe('parseVersion', () => {
  it('splits /<service>/vN/<tail>', () => {
    expect(parseVersion('/bitable/v2/apps/x')).toEqual({ prefix: '/bitable', service: 'bitable', ver: 2, tail: '/apps/x' })
    expect(parseVersion('/docx/v1/documents/abc/blocks')).toMatchObject({ service: 'docx', ver: 1 })
  })
  it('returns null when there is no /vN/ segment', () => {
    expect(parseVersion('/authen/oauth/token')).toBeNull()
    expect(parseVersion('/nope')).toBeNull()
  })
})

describe('versionCandidates — highest→lowest, no hardcoding', () => {
  it('yields vN down to v1', () => {
    expect(versionCandidates('/sheets/v3/spreadsheets/x').map((c) => c.ver)).toEqual([3, 2, 1])
    expect(versionCandidates('/bitable/v2/apps').map((c) => c.path)).toEqual(['/bitable/v2/apps', '/bitable/v1/apps'])
  })
  it('a v1 path has nothing older to try', () => {
    expect(versionCandidates('/docx/v1/documents/x').map((c) => c.ver)).toEqual([1])
  })
  it('a path without a version yields itself once', () => {
    expect(versionCandidates('/im/raw')).toEqual([{ path: '/im/raw', ver: 0 }])
  })
})

describe('rememberVersion — probe once, then go straight to the working version', () => {
  it('after discovering v1 works, candidates start at v1 (skip the absent v3/v2)', () => {
    rememberVersion('/sheets/v3/spreadsheets/x', 1)
    expect(versionCandidates('/sheets/v3/spreadsheets/y').map((c) => c.ver)).toEqual([1])
    // a DIFFERENT original version of the same service is its own key
    expect(versionCandidates('/sheets/v2/spreadsheets/y').map((c) => c.ver)).toEqual([2, 1])
  })
  it('remembering the same version keeps a single shot', () => {
    rememberVersion('/bitable/v1/apps', 1)
    expect(versionCandidates('/bitable/v1/apps').map((c) => c.ver)).toEqual([1])
  })
  it('ignores ver < 1 and unparseable paths', () => {
    rememberVersion('/bitable/v2/apps', 0)
    expect(versionCandidates('/bitable/v2/apps').map((c) => c.ver)).toEqual([2, 1]) // not cached
    rememberVersion('/no-version', 1) // no-op, no throw
  })
})
