import { describe, it, expect } from 'vitest'
import { ipInCidr } from './network'

describe('ipInCidr', () => {
  it('matches an address inside a /8 block', () => {
    expect(ipInCidr('10.1.2.3', '10.0.0.0/8')).toBe(true)
  })

  it('rejects an address outside a /8 block', () => {
    expect(ipInCidr('192.168.1.5', '10.0.0.0/8')).toBe(false)
  })

  it('matches within a /24 block', () => {
    expect(ipInCidr('192.168.1.5', '192.168.1.0/24')).toBe(true)
    expect(ipInCidr('192.168.2.5', '192.168.1.0/24')).toBe(false)
  })

  it('treats a bare address as /32 (exact match only)', () => {
    expect(ipInCidr('192.168.1.5', '192.168.1.5')).toBe(true)
    expect(ipInCidr('192.168.1.6', '192.168.1.5')).toBe(false)
  })

  it('matches everything with /0', () => {
    expect(ipInCidr('8.8.8.8', '0.0.0.0/0')).toBe(true)
    expect(ipInCidr('255.255.255.255', '0.0.0.0/0')).toBe(true)
  })

  it('handles the top of the address space without sign issues', () => {
    expect(ipInCidr('255.255.255.255', '255.255.255.0/24')).toBe(true)
    expect(ipInCidr('255.255.254.1', '255.255.255.0/24')).toBe(false)
  })
})
