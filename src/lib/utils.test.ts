import { describe, expect, it } from 'vitest'
import { amountToWei, formatPot, isValidAddress, shortAddress } from './utils'

const POT = 10n ** 18n

describe('formatPot', () => {
  it('formats zero', () => expect(formatPot(0n)).toBe('0'))
  it('formats whole POT without trailing decimals', () => expect(formatPot(10n * POT)).toBe('10'))
  it('formats fractional POT', () => expect(formatPot(15n * POT / 10n)).toBe('1.5'))
  it('keeps small-unit precision', () => expect(formatPot(1n)).toBe('0.000000000000000001'))
  it('does not hide precision beyond two digits when it matters', () => expect(formatPot(1005n * POT / 1000n)).toBe('1.005'))
  it('groups thousands', () => expect(formatPot(1_250_000n * POT)).toBe('1,250,000'))
})

describe('amountToWei', () => {
  it('parses POT with 18 decimals', () => expect(amountToWei('2.5')).toBe(25n * POT / 10n))
  it('rejects more than 18 decimal places', () => expect(() => amountToWei('0.0000000000000000001')).toThrow())
  it('rejects non-numeric input', () => expect(() => amountToWei('ten')).toThrow())
})

describe('addresses', () => {
  it('shortens addresses', () => expect(shortAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234…5678'))
  it('handles missing addresses', () => expect(shortAddress(undefined)).toBe('—'))
  it('validates address shape', () => {
    expect(isValidAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe(true)
    expect(isValidAddress('0x1234')).toBe(false)
    expect(isValidAddress('1234567890abcdef1234567890abcdef12345678')).toBe(false)
  })
})
