/** Deterministic DOI, arXiv, URL, and Markdown citation extraction. */

/** Citation families that CiteGuard can verify mechanically. */
export type CitationKind = 'doi' | 'arxiv' | 'url'

/** One normalized citation with a stable input location. */
export interface Citation {
  readonly id: string
  readonly kind: CitationKind
  readonly normalized: string
  readonly raw: string
  readonly url: string | null
  readonly expectedTitle: string | null
  readonly start: number
  readonly end: number
  readonly line: number
  readonly column: number
  readonly context: string
}

/** A deliberately weak, proximity-only claim association. */
export interface ClaimAssociation {
  readonly claim: string
  readonly citationIds: readonly string[]
  readonly start: number
  readonly end: number
  readonly basis: 'same-sentence-proximity'
}

/** Offline extraction report. */
export interface ExtractionReport {
  readonly totalChars: number
  readonly citations: readonly Citation[]
  readonly associations: readonly ClaimAssociation[]
}

interface Candidate {
  kind: CitationKind
  normalized: string
  raw: string
  url: string | null
  expectedTitle: string | null
  start: number
  end: number
}

interface MarkdownLink {
  readonly label: string
  readonly target: string
  readonly raw: string
  readonly start: number
  readonly end: number
}

const URL_PATTERN = /https?:\/\/[^\s<>"']+/giu
const DOI_PATTERN = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/giu
const ARXIV_PATTERN = /\b(?:arXiv\s*:\s*)?(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[a-z]{2})?\/\d{7}(?:v\d+)?)/giu

/** Linear, bounded Markdown-link scanner for untrusted model output. */
function markdownLinks(input: string): readonly MarkdownLink[] {
  const links: MarkdownLink[] = []
  let cursor = 0
  while (cursor < input.length) {
    const start = input.indexOf('[', cursor)
    if (start < 0) break

    let labelEnd = -1
    const labelLimit = Math.min(input.length - 1, start + 501)
    for (let index = start + 1; index <= labelLimit; index += 1) {
      const character = input[index]
      if (character === '\n' || character === '\r') break
      if (character === ']') {
        labelEnd = index
        break
      }
    }
    if (labelEnd <= start + 1 || input[labelEnd + 1] !== '(') {
      cursor = start + 1
      continue
    }

    const targetStart = labelEnd + 2
    const scheme = input.slice(targetStart, targetStart + 8).toLowerCase()
    if (!scheme.startsWith('http://') && !scheme.startsWith('https://')) {
      cursor = start + 1
      continue
    }

    let targetEnd = targetStart
    while (targetEnd < input.length && input[targetEnd] !== ')' && !/\s/u.test(input[targetEnd] ?? '')) targetEnd += 1
    if (input[targetEnd] !== ')') {
      cursor = Math.min(input.length, targetEnd + 1)
      continue
    }

    const end = targetEnd + 1
    links.push({
      label: input.slice(start + 1, labelEnd),
      target: input.slice(targetStart, targetEnd),
      raw: input.slice(start, end),
      start,
      end,
    })
    cursor = end
  }
  return links
}

function trimUrl(value: string): string {
  let result = value
  while (/[.,;:!?\])}]/u.test(result.at(-1) ?? '')) result = result.slice(0, -1)
  return result
}

function trimDoi(value: string): string {
  let result = value.replace(/^doi\s*:\s*/iu, '')
  while (/[.,;:!?\])}]/u.test(result.at(-1) ?? '')) result = result.slice(0, -1)
  return result.toLowerCase()
}

function arxivBase(value: string): string {
  return value.replace(/^arxiv\s*:\s*/iu, '').replace(/v\d+$/iu, '').toLowerCase()
}

function titleLabel(label: string, target: string): string | null {
  const compact = label.replace(/\s+/gu, ' ').trim()
  if (compact.length < 4 || compact === target || /^https?:\/\//iu.test(compact)) return null
  if (/^(?:link|source|paper|reference|here|链接|来源|论文|参考)$/iu.test(compact)) return null
  return compact
}

function fromTarget(target: string, raw: string, label: string | null, start: number, end: number): Candidate | null {
  const cleaned = trimUrl(target)
  let parsed: URL
  try {
    parsed = new URL(cleaned)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  if (host === 'doi.org' || host === 'dx.doi.org') {
    let decodedPath: string
    try {
      decodedPath = decodeURIComponent(parsed.pathname.slice(1))
    } catch {
      return null
    }
    const doi = trimDoi(decodedPath)
    if (DOI_PATTERN.test(doi)) {
      DOI_PATTERN.lastIndex = 0
      return { kind: 'doi', normalized: doi, raw, url: `https://doi.org/${doi}`, expectedTitle: label, start, end }
    }
    DOI_PATTERN.lastIndex = 0
  }
  if (host === 'arxiv.org' || host.endsWith('.arxiv.org')) {
    const match = parsed.pathname.match(/^\/(?:abs|pdf)\/(.+?)(?:\.pdf)?$/iu)
    if (match?.[1] !== undefined) {
      const id = arxivBase(match[1])
      return { kind: 'arxiv', normalized: id, raw, url: `https://arxiv.org/abs/${id}`, expectedTitle: label, start, end }
    }
  }
  parsed.hash = ''
  return { kind: 'url', normalized: parsed.href, raw, url: parsed.href, expectedTitle: label, start, end }
}

function locate(input: string, offset: number): { line: number, column: number } {
  const before = input.slice(0, offset)
  const line = before.split('\n').length
  const lastBreak = before.lastIndexOf('\n')
  return { line, column: offset - lastBreak }
}

function contextAround(input: string, start: number, end: number): string {
  const left = Math.max(input.lastIndexOf('\n', start - 1), input.lastIndexOf('.', start - 1), input.lastIndexOf('。', start - 1))
  const rightCandidates = [input.indexOf('\n', end), input.indexOf('.', end), input.indexOf('。', end)].filter(value => value >= 0)
  const right = rightCandidates.length === 0 ? input.length : Math.min(...rightCandidates) + 1
  return input.slice(Math.max(0, left + 1), right).replace(/\s+/gu, ' ').trim().slice(0, 500)
}

function claimAssociations(input: string, citations: readonly Citation[]): readonly ClaimAssociation[] {
  const boundaries = [0]
  for (const match of input.matchAll(/[.!?。！？\n]+/gu)) {
    const punctuationStart = match.index ?? 0
    if (citations.some(citation => punctuationStart >= citation.start && punctuationStart < citation.end)) continue
    boundaries.push(punctuationStart + match[0].length)
  }
  if (boundaries.at(-1) !== input.length) boundaries.push(input.length)
  const associations: ClaimAssociation[] = []
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index]
    const end = boundaries[index + 1]
    if (start === undefined || end === undefined || end <= start) continue
    const nearby = citations.filter(citation => citation.start >= start && citation.start < end)
    if (nearby.length === 0) continue
    let claim = input.slice(start, end)
    for (const citation of [...nearby].sort((left, right) => right.start - left.start)) {
      const localStart = citation.start - start
      claim = `${claim.slice(0, localStart)} ${claim.slice(localStart + citation.raw.length)}`
    }
    claim = claim
      .replace(/\(\s*\)|（\s*）|\[\s*\]|\{\s*\}/gu, ' ')
      .replace(/\s+([.,;:!?。！？])/gu, '$1')
      .replace(/\s+/gu, ' ')
      .trim()
    if (claim.length === 0) continue
    associations.push({
      claim: claim.slice(0, 500),
      citationIds: nearby.map(citation => citation.id),
      start,
      end,
      basis: 'same-sentence-proximity',
    })
  }
  return associations
}

/** Extract and deduplicate supported citation targets without network access. */
export function extractCitations(input: string): ExtractionReport {
  const candidates: Candidate[] = []
  for (const match of markdownLinks(input)) {
    const candidate = fromTarget(match.target, match.raw, titleLabel(match.label, match.target), match.start, match.end)
    if (candidate !== null) candidates.push(candidate)
  }
  for (const match of input.matchAll(URL_PATTERN)) {
    if (match.index === undefined) continue
    const candidate = fromTarget(match[0], trimUrl(match[0]), null, match.index, match.index + trimUrl(match[0]).length)
    if (candidate !== null) candidates.push(candidate)
  }
  for (const match of input.matchAll(DOI_PATTERN)) {
    if (match.index === undefined) continue
    const doi = trimDoi(match[0])
    const raw = match[0].slice(0, doi.length)
    candidates.push({ kind: 'doi', normalized: doi, raw, url: `https://doi.org/${doi}`, expectedTitle: null, start: match.index, end: match.index + raw.length })
  }
  for (const match of input.matchAll(ARXIV_PATTERN)) {
    if (match.index === undefined || match[1] === undefined) continue
    const id = arxivBase(match[1])
    candidates.push({ kind: 'arxiv', normalized: id, raw: match[0], url: `https://arxiv.org/abs/${id}`, expectedTitle: null, start: match.index, end: match.index + match[0].length })
  }

  const deduplicated = new Map<string, Candidate>()
  for (const candidate of candidates.sort((left, right) => left.start - right.start || right.raw.length - left.raw.length)) {
    const key = `${candidate.kind}:${candidate.normalized}`
    const previous = deduplicated.get(key)
    if (previous === undefined || (previous.expectedTitle === null && candidate.expectedTitle !== null)) deduplicated.set(key, candidate)
  }
  const citations = [...deduplicated.values()]
    .sort((left, right) => left.start - right.start)
    .map((candidate, index): Citation => {
      const position = locate(input, candidate.start)
      return {
        id: `cite-${index + 1}`,
        ...candidate,
        line: position.line,
        column: position.column,
        context: contextAround(input, candidate.start, candidate.end),
      }
    })
  return { totalChars: input.length, citations, associations: claimAssociations(input, citations) }
}
