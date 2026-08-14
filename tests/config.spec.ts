import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'

describe('CiteGuard configuration', () => {
  it('resolves bounded metadata defaults', () => {
    expect(resolveConfig()).toEqual({
      enabled: true,
      networkMode: 'metadata',
      timeoutMs: 8_000,
      maxResponseBytes: 1_048_576,
      maxRedirects: 4,
      minTitleSimilarity: 0.55,
      maxTextChars: 200_000,
      maxCitations: 100,
    })
  })

  it.each(['off', 'metadata', 'full'] as const)('accepts %s network mode', networkMode => {
    expect(resolveConfig({ networkMode }).networkMode).toBe(networkMode)
  })

  it('rejects invalid caps and similarity thresholds', () => {
    expect(() => resolveConfig({ maxCitations: 1.5 })).toThrow('integer')
    expect(() => resolveConfig({ minTitleSimilarity: 2 })).toThrow('0 through 1')
  })
})
