import { describe, expect, it, vi } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { checkCitations, titleSimilarity } from '../src/verifier.ts'
import { formatCiteGuardReport } from '../src/tool.ts'

const publicDns = async (): Promise<readonly string[]> => ['93.184.216.34']

describe('citation verification', () => {
  it('compares provider and explicit titles deterministically', () => {
    expect(titleSimilarity('Attention Is All You Need', 'Attention Is All You Need')).toBe(1)
    expect(titleSimilarity('Unrelated Study', 'Attention Is All You Need')).toBe(0)
  })

  it('verifies DOI metadata through the fixed Crossref endpoint', async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toContain('api.crossref.org/works/')
      return new Response(JSON.stringify({
        message: {
          title: ['Attention Is All You Need'],
          author: [{ given: 'Ashish', family: 'Vaswani' }],
          published: { 'date-parts': [[2017]] },
          URL: 'https://doi.org/10.5555/3295222.3295349',
        },
      }), { headers: { 'content-type': 'application/json' } })
    })
    const report = await checkCitations(
      '[Attention Is All You Need](https://doi.org/10.5555/3295222.3295349)',
      resolveConfig(),
      { online: true },
      { fetcher, resolveHost: publicDns },
    )
    expect(report.results[0]).toMatchObject({ status: 'verified', titleSimilarity: 1 })
    expect(report.results[0]?.metadata?.authors).toEqual(['Ashish Vaswani'])
  })

  it('verifies arXiv metadata and reports title mismatches', async () => {
    const atom = `<?xml version="1.0"?><feed><entry><title>Real Paper Title</title><published>2024-01-02T00:00:00Z</published><author><name>Ada Lovelace</name></author></entry></feed>`
    const report = await checkCitations(
      '[Completely Different Topic](https://arxiv.org/abs/2401.12345)',
      resolveConfig(),
      { online: true },
      { fetcher: async () => new Response(atom), resolveHost: publicDns },
    )
    expect(report.results[0]?.status).toBe('mismatch')
    expect(report.results[0]?.metadata?.provider).toBe('arxiv')
  })

  it('does not request arbitrary URLs in metadata mode', async () => {
    const fetcher = vi.fn(async () => new Response('unexpected'))
    const report = await checkCitations('See https://example.com/paper.', resolveConfig(), { online: true }, { fetcher, resolveHost: publicDns })
    expect(report.results[0]?.status).toBe('unverified')
    expect(report.networkUsed).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('blocks private URL targets in full mode', async () => {
    const report = await checkCitations('See http://127.0.0.1/admin.', resolveConfig({ networkMode: 'full' }), { online: true })
    expect(report.results[0]?.status).toBe('blocked')
  })

  it('stays offline when requested and preserves the evidence limitation', async () => {
    const report = await checkCitations('Claim (10.1234/example).', resolveConfig(), { online: false })
    expect(report.results[0]?.status).toBe('unverified')
    expect(report.networkUsed).toBe(false)
    const rendered = formatCiteGuardReport(report)
    expect(rendered).toContain('do not prove')
    expect(rendered).toContain('Proximity-only')
  })

  it('caps work before network requests', async () => {
    const fetcher = vi.fn(async () => new Response('{}'))
    const report = await checkCitations(
      '10.1234/one 10.1234/two',
      resolveConfig({ maxCitations: 1 }),
      { online: false },
      { fetcher, resolveHost: publicDns },
    )
    expect(report.checkedCitations).toBe(1)
    expect(report.omittedCitations).toBe(1)
    expect(fetcher).not.toHaveBeenCalled()
  })
})
