/** Citation validation and provider-specific metadata verification. */

import type { ResolvedConfig } from './config.ts'
import { extractCitations, type Citation, type ClaimAssociation } from './extractor.ts'
import { fetchSafeText, NetworkGuardError, type FetchLike, type ResolveHost, type SafeRequestOptions } from './network.ts'

/** Mechanical outcome; none of these values imply that a source supports a claim. */
export type VerificationStatus = 'verified' | 'reachable' | 'unverified' | 'invalid' | 'mismatch' | 'unreachable' | 'blocked'

/** Provider metadata used for identifier and label checks. */
export interface CitationMetadata {
  readonly provider: 'crossref' | 'arxiv' | 'web'
  readonly title: string | null
  readonly authors: readonly string[]
  readonly year: number | null
  readonly canonicalUrl: string
}

/** One citation result with explicit evidence boundaries. */
export interface CitationResult {
  readonly citation: Citation
  readonly status: VerificationStatus
  readonly reason: string
  readonly titleSimilarity: number | null
  readonly metadata: CitationMetadata | null
}

/** Stable JSON-safe CiteGuard receipt. */
export interface CiteGuardReport {
  readonly version: 1
  readonly totalChars: number
  readonly checkedCitations: number
  readonly omittedCitations: number
  readonly counts: Readonly<Record<VerificationStatus, number>>
  readonly results: readonly CitationResult[]
  readonly associations: readonly ClaimAssociation[]
  readonly networkUsed: boolean
  readonly limitation: string
}

/** Optional network dependencies for deterministic tests and embeddings. */
export interface VerificationDependencies {
  readonly fetcher?: FetchLike
  readonly resolveHost?: ResolveHost
}

function normalizeTitle(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/gu, ' ').trim()
}

/** Token-set Jaccard similarity for an explicit citation label and provider title. */
export function titleSimilarity(left: string, right: string): number {
  const leftTokens = new Set(normalizeTitle(left).split(' ').filter(Boolean))
  const rightTokens = new Set(normalizeTitle(right).split(' ').filter(Boolean))
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0
  let intersection = 0
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1
  return intersection / new Set([...leftTokens, ...rightTokens]).size
}

function xmlDecode(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|#39);/gu, entity => {
    switch (entity) {
      case '&amp;': return '&'
      case '&lt;': return '<'
      case '&gt;': return '>'
      case '&quot;': return '"'
      case '&#39;': return "'"
      default: return entity
    }
  })
}

function xmlFirst(source: string, tag: string): string | null {
  const match = source.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'iu'))
  return match?.[1] === undefined ? null : xmlDecode(match[1].replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim())
}

function xmlAll(source: string, tag: string): readonly string[] {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'giu')
  return [...source.matchAll(pattern)]
    .map(match => match[1] === undefined ? '' : xmlDecode(match[1].replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim()))
    .filter(Boolean)
}

function requestOptions(
  config: ResolvedConfig,
  dependencies: VerificationDependencies,
  signal?: AbortSignal,
  allowedHosts?: readonly string[],
): SafeRequestOptions {
  return {
    timeoutMs: config.timeoutMs,
    maxResponseBytes: config.maxResponseBytes,
    maxRedirects: config.maxRedirects,
    ...(dependencies.fetcher === undefined ? {} : { fetcher: dependencies.fetcher }),
    ...(dependencies.resolveHost === undefined ? {} : { resolveHost: dependencies.resolveHost }),
    ...(signal === undefined ? {} : { signal }),
    ...(allowedHosts === undefined ? {} : { allowedHosts }),
    headers: {
      accept: 'application/json, application/atom+xml, text/html;q=0.8, */*;q=0.1',
      'user-agent': 'CiteGuard/0.1 (+DeepSeek-Harness-plugin)',
    },
  }
}

async function crossref(citation: Citation, config: ResolvedConfig, dependencies: VerificationDependencies, signal?: AbortSignal): Promise<CitationMetadata> {
  const endpoint = `https://api.crossref.org/works/${encodeURIComponent(citation.normalized)}`
  const response = await fetchSafeText(endpoint, requestOptions(config, dependencies, signal, ['api.crossref.org']))
  const parsed = JSON.parse(response.text) as {
    message?: {
      title?: unknown
      author?: unknown
      published?: unknown
      issued?: unknown
      URL?: unknown
    }
  }
  const message = parsed.message
  if (message === undefined) throw new NetworkGuardError('http-error', 'Crossref response omitted the work record.')
  const titleValues = Array.isArray(message.title) ? message.title : []
  const title = typeof titleValues[0] === 'string' ? titleValues[0].replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim() : null
  const authorValues = Array.isArray(message.author) ? message.author : []
  const authors = authorValues.flatMap(value => {
    if (typeof value !== 'object' || value === null) return []
    const record = value as Record<string, unknown>
    const name = [record.given, record.family].filter(part => typeof part === 'string').join(' ').trim()
    return name.length === 0 ? [] : [name]
  })
  const dateSource = (message.published ?? message.issued) as { ['date-parts']?: unknown } | undefined
  const dateParts = dateSource?.['date-parts']
  const firstDate = Array.isArray(dateParts) && Array.isArray(dateParts[0]) ? dateParts[0][0] : null
  const year = typeof firstDate === 'number' ? firstDate : null
  return {
    provider: 'crossref',
    title,
    authors,
    year,
    canonicalUrl: typeof message.URL === 'string' ? message.URL : `https://doi.org/${citation.normalized}`,
  }
}

async function arxiv(citation: Citation, config: ResolvedConfig, dependencies: VerificationDependencies, signal?: AbortSignal): Promise<CitationMetadata> {
  const endpoint = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(citation.normalized)}`
  const response = await fetchSafeText(endpoint, requestOptions(config, dependencies, signal, ['export.arxiv.org']))
  const entry = response.text.match(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/iu)?.[1]
  if (entry === undefined) throw new NetworkGuardError('http-error', 'arXiv did not return a matching record.')
  const published = xmlFirst(entry, 'published')
  const authorEntries = xmlAll(entry, 'author')
  const authors = authorEntries.map(value => xmlFirst(value, 'name') ?? value).filter(Boolean)
  return {
    provider: 'arxiv',
    title: xmlFirst(entry, 'title'),
    authors,
    year: published === null ? null : Number.parseInt(published.slice(0, 4), 10),
    canonicalUrl: `https://arxiv.org/abs/${citation.normalized}`,
  }
}

async function web(citation: Citation, config: ResolvedConfig, dependencies: VerificationDependencies, signal?: AbortSignal): Promise<CitationMetadata> {
  if (citation.url === null) throw new NetworkGuardError('invalid-url', 'Citation URL is missing.')
  const response = await fetchSafeText(citation.url, requestOptions(config, dependencies, signal))
  const title = response.text.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/iu)?.[1]
  return {
    provider: 'web',
    title: title === undefined ? null : xmlDecode(title.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim()),
    authors: [],
    year: null,
    canonicalUrl: response.finalUrl,
  }
}

function syntacticallyValid(citation: Citation): boolean {
  if (citation.kind === 'doi') return /^10\.\d{4,9}\/\S+$/u.test(citation.normalized)
  if (citation.kind === 'arxiv') return /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})$/iu.test(citation.normalized)
  try {
    const url = new URL(citation.normalized)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function offline(citation: Citation, reason: string): CitationResult {
  return { citation, status: syntacticallyValid(citation) ? 'unverified' : 'invalid', reason, titleSimilarity: null, metadata: null }
}

function fromMetadata(citation: Citation, metadata: CitationMetadata, threshold: number): CitationResult {
  const similarity = citation.expectedTitle === null || metadata.title === null ? null : titleSimilarity(citation.expectedTitle, metadata.title)
  if (similarity !== null && similarity < threshold) {
    return {
      citation,
      status: 'mismatch',
      reason: `Provider metadata resolved, but the explicit link label had only ${similarity.toFixed(2)} title similarity.`,
      titleSimilarity: similarity,
      metadata,
    }
  }
  return {
    citation,
    status: citation.kind === 'url' ? 'reachable' : 'verified',
    reason: citation.kind === 'url' ? 'The public URL responded within policy limits.' : 'The identifier resolved at its constrained metadata provider.',
    titleSimilarity: similarity,
    metadata,
  }
}

async function verifyOne(citation: Citation, config: ResolvedConfig, dependencies: VerificationDependencies, online: boolean, signal?: AbortSignal): Promise<CitationResult> {
  if (!syntacticallyValid(citation)) return offline(citation, 'The identifier or URL is syntactically invalid.')
  if (!online || config.networkMode === 'off') return offline(citation, 'Offline extraction only; no provider was contacted.')
  if (citation.kind === 'url' && config.networkMode !== 'full') {
    return offline(citation, 'Arbitrary URL requests require networkMode=full; no request was made.')
  }
  try {
    const metadata = citation.kind === 'doi'
      ? await crossref(citation, config, dependencies, signal)
      : citation.kind === 'arxiv'
        ? await arxiv(citation, config, dependencies, signal)
        : await web(citation, config, dependencies, signal)
    return fromMetadata(citation, metadata, config.minTitleSimilarity)
  } catch (error) {
    if (error instanceof NetworkGuardError) {
      const blocked = error.code === 'blocked-host' || error.code === 'invalid-url' || error.code === 'response-too-large' || error.code === 'too-many-redirects'
      return { citation, status: blocked ? 'blocked' : 'unreachable', reason: error.message, titleSimilarity: null, metadata: null }
    }
    return { citation, status: 'unreachable', reason: error instanceof Error ? error.message : 'Citation verification failed.', titleSimilarity: null, metadata: null }
  }
}

/** Extract citations and optionally verify them under the configured network policy. */
export async function checkCitations(
  input: string,
  config: ResolvedConfig,
  options: { readonly online?: boolean; readonly signal?: AbortSignal } = {},
  dependencies: VerificationDependencies = {},
): Promise<CiteGuardReport> {
  if (input.length > config.maxTextChars) throw new RangeError(`input exceeds maxTextChars=${config.maxTextChars}`)
  const extracted = extractCitations(input)
  const selected = extracted.citations.slice(0, config.maxCitations)
  const online = options.online ?? true
  const results: CitationResult[] = []
  for (const citation of selected) {
    results.push(await verifyOne(citation, config, dependencies, online, options.signal))
  }
  const counts: Record<VerificationStatus, number> = {
    verified: 0,
    reachable: 0,
    unverified: 0,
    invalid: 0,
    mismatch: 0,
    unreachable: 0,
    blocked: 0,
  }
  for (const result of results) counts[result.status] += 1
  return {
    version: 1,
    totalChars: input.length,
    checkedCitations: results.length,
    omittedCitations: extracted.citations.length - results.length,
    counts,
    results,
    associations: extracted.associations,
    networkUsed: online && config.networkMode !== 'off' && selected.some(citation =>
      syntacticallyValid(citation) && (citation.kind !== 'url' || config.networkMode === 'full'),
    ),
    limitation: 'Resolution and title checks do not prove that a source is true or supports a nearby claim. Claim associations are based only on same-sentence proximity.',
  }
}
