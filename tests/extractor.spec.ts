import { describe, expect, it } from 'vitest'
import { extractCitations } from '../src/extractor.ts'

describe('citation extraction', () => {
  it('extracts Markdown DOI, arXiv, and URL targets and deduplicates repeats', () => {
    const input = [
      '[Attention Is All You Need](https://doi.org/10.5555/3295222.3295349).',
      'Repeated as DOI 10.5555/3295222.3295349; preprint arXiv:1706.03762.',
      'Dataset: https://example.com/data.csv.',
    ].join('\n')
    const report = extractCitations(input)
    expect(report.citations.map(citation => citation.kind)).toEqual(['doi', 'arxiv', 'url'])
    expect(report.citations[0]?.expectedTitle).toBe('Attention Is All You Need')
    expect(report.citations[0]?.line).toBe(1)
    expect(report.citations[1]?.normalized).toBe('1706.03762')
    expect(report.citations[2]?.normalized).toBe('https://example.com/data.csv')
  })

  it('normalizes legacy arXiv links and strips version suffixes', () => {
    const report = extractCitations('See https://arxiv.org/abs/math/0301234v2 for details.')
    expect(report.citations).toHaveLength(1)
    expect(report.citations[0]).toMatchObject({ kind: 'arxiv', normalized: 'math/0301234' })
  })

  it('labels nearby claims as proximity associations only', () => {
    const report = extractCitations('该方法提升了准确率（10.1234/example）。下一句没有引用。')
    expect(report.associations).toHaveLength(1)
    expect(report.associations[0]?.basis).toBe('same-sentence-proximity')
    expect(report.associations[0]?.claim).toContain('提升了准确率')
  })

  it('does not treat generic Markdown labels as expected titles', () => {
    const report = extractCitations('[source](https://example.com/paper)')
    expect(report.citations[0]?.expectedTitle).toBeNull()
  })

  it('handles adversarial incomplete Markdown links without regex backtracking', () => {
    const adversarial = '[!](http://'.repeat(10_000)
    const report = extractCitations(`${adversarial} \n[Valid Paper](https://example.com/paper)`)
    expect(report.citations).toHaveLength(1)
    expect(report.citations[0]).toMatchObject({
      kind: 'url',
      normalized: 'https://example.com/paper',
      expectedTitle: 'Valid Paper',
    })
  })

  it('ignores malformed percent-encoded DOI links instead of throwing', () => {
    expect(extractCitations('[bad DOI](https://doi.org/10.1234/%E0%A4%A)').citations).toEqual([])
  })
})
