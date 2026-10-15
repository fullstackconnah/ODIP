import { describe, expect, it } from 'vitest'
import { formatBytes } from './format'

describe('formatBytes', () => {
  it('is KB below 1 MB, then MB and GB to one decimal, and never a percentage', () => {
    expect(formatBytes(0)).toBe('0 KB')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(1024 * 1024 - 1)).toBe('1024 KB')
    expect(formatBytes(13_002_342)).toBe('12.4 MB')
    expect(formatBytes(1.25 * 1024 ** 3)).toBe('1.3 GB')
  })
})
