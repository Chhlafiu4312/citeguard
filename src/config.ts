/**
 * Serializable CiteGuard configuration and direct-call defaults.
 * @module dsh-citeguard/config
 */

import z from '@deepseek-ai/schemastery'

/** Network surface allowed to CiteGuard. */
export type NetworkMode = 'off' | 'metadata' | 'full'

/** Plugin configuration supplied by the profile composition. */
export interface Config {
  /** Whether CiteGuard tool registration is enabled. */
  enabled?: boolean
  /** `metadata` contacts only Crossref and arXiv; `full` may inspect cited URLs. */
  networkMode?: NetworkMode
  /** Per-request deadline in milliseconds. */
  timeoutMs?: number
  /** Maximum response body accepted from any provider. */
  maxResponseBytes?: number
  /** Maximum validated redirects. */
  maxRedirects?: number
  /** Minimum token similarity when an explicit Markdown label looks like a title. */
  minTitleSimilarity?: number
  /** Maximum input length accepted by one check. */
  maxTextChars?: number
  /** Maximum citations verified in one invocation. */
  maxCitations?: number
}

/** Configuration after defaults have been resolved. */
export interface ResolvedConfig {
  /** Whether CiteGuard tool registration is enabled. */
  enabled: boolean
  networkMode: NetworkMode
  timeoutMs: number
  maxResponseBytes: number
  maxRedirects: number
  minTitleSimilarity: number
  maxTextChars: number
  maxCitations: number
}

/** Loader-visible configuration schema and defaults. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  networkMode: z.union(['off', 'metadata', 'full']).default('metadata'),
  timeoutMs: z.number().min(500).max(60_000).default(8_000),
  maxResponseBytes: z.number().min(16_384).max(10_485_760).default(1_048_576),
  maxRedirects: z.number().min(0).max(10).default(4),
  minTitleSimilarity: z.number().min(0).max(1).default(0.55),
  maxTextChars: z.number().min(1024).max(2_000_000).default(200_000),
  maxCitations: z.number().min(1).max(500).default(100),
})

function integer(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be an integer from ${minimum} through ${maximum}`)
  }
  return value
}

/**
 * Resolve the same defaults for direct callers that bypass Cordis Loader.
 * @param config - Partial serialized configuration.
 * @returns Configuration with all template defaults applied.
 */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  const timeoutMs = integer(config.timeoutMs ?? 8_000, 'timeoutMs', 500, 60_000)
  const maxResponseBytes = integer(config.maxResponseBytes ?? 1_048_576, 'maxResponseBytes', 16_384, 10_485_760)
  const maxRedirects = integer(config.maxRedirects ?? 4, 'maxRedirects', 0, 10)
  const maxTextChars = integer(config.maxTextChars ?? 200_000, 'maxTextChars', 1024, 2_000_000)
  const maxCitations = integer(config.maxCitations ?? 100, 'maxCitations', 1, 500)
  const minTitleSimilarity = config.minTitleSimilarity ?? 0.55
  if (!Number.isFinite(minTitleSimilarity) || minTitleSimilarity < 0 || minTitleSimilarity > 1) {
    throw new TypeError('minTitleSimilarity must be a number from 0 through 1')
  }
  return {
    enabled: config.enabled ?? true,
    networkMode: config.networkMode ?? 'metadata',
    timeoutMs,
    maxResponseBytes,
    maxRedirects,
    minTitleSimilarity,
    maxTextChars,
    maxCitations,
  }
}
