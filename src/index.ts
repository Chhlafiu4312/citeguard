/**
 * CiteGuard function plugin for DeepSeek Harness.
 * @module dsh-citeguard
 */

/** Cordis plugin name; keep this stable after publishing. */
export const name = 'citeguard'

/** Services that must exist before the plugin is applied. */
export const inject = ['tools']

export { Config, resolveConfig } from './config.ts'
export type { NetworkMode, ResolvedConfig } from './config.ts'
export { apply } from './runtime.ts'
export type { PluginRuntime } from './runtime.ts'
export { extractCitations } from './extractor.ts'
export type { Citation, CitationKind, ClaimAssociation, ExtractionReport } from './extractor.ts'
export { assertSafeHttpUrl, fetchSafeText, isPublicAddress, NetworkGuardError } from './network.ts'
export type { FetchLike, ResolveHost, SafeRequestOptions, SafeTextResponse } from './network.ts'
export { checkCitations, titleSimilarity } from './verifier.ts'
export type { CiteGuardReport, CitationMetadata, CitationResult, VerificationDependencies, VerificationStatus } from './verifier.ts'
export { createCiteGuardTool, formatCiteGuardReport } from './tool.ts'
