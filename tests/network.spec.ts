import { describe, expect, it, vi } from 'vitest'
import { assertSafeHttpUrl, fetchSafeText, isPublicAddress } from '../src/network.ts'

const publicDns = async (): Promise<readonly string[]> => ['93.184.216.34']

describe('safe citation transport', () => {
  it('classifies representative public and non-public addresses', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true)
    expect(isPublicAddress('10.0.0.1')).toBe(false)
    expect(isPublicAddress('169.254.169.254')).toBe(false)
    expect(isPublicAddress('::1')).toBe(false)
    expect(isPublicAddress('2001:4860:4860::8888')).toBe(true)
    expect(isPublicAddress('0:0:0:0:0:0:0:1')).toBe(false)
    expect(isPublicAddress('0:0:0:0:0:0:0:0')).toBe(false)
    expect(isPublicAddress('fec0::1')).toBe(false)
    expect(isPublicAddress('2002:7f00:1::')).toBe(false)
    expect(isPublicAddress('0:0:0:0:0:ffff:7f00:1')).toBe(false)
    expect(isPublicAddress('192.0.0.8')).toBe(false)
    expect(isPublicAddress('192.0.0.9')).toBe(true)
    expect(isPublicAddress('192.88.99.1')).toBe(false)
    expect(isPublicAddress('100:0:0:1::1')).toBe(false)
    expect(isPublicAddress('5f00::1')).toBe(false)
    expect(isPublicAddress('2001:3::1')).toBe(true)
  })

  it('rejects local names, credentials, and private DNS answers', async () => {
    await expect(assertSafeHttpUrl('http://localhost/paper', publicDns)).rejects.toMatchObject({ code: 'blocked-host' })
    await expect(assertSafeHttpUrl('https://user:pass@example.com/paper', publicDns)).rejects.toMatchObject({ code: 'blocked-host' })
    await expect(assertSafeHttpUrl('https://example.com/paper', async () => ['192.168.1.2'])).rejects.toMatchObject({ code: 'blocked-host' })
  })

  it('validates every redirect before the next request', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/admin' } }))
    await expect(fetchSafeText('https://example.com/paper', {
      fetcher,
      resolveHost: publicDns,
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 3,
    })).rejects.toMatchObject({ code: 'blocked-host' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('passes the validated DNS answer set to the connection transport', async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit, addresses: readonly string[]) => {
      expect(addresses).toEqual(['93.184.216.34'])
      return new Response('ok')
    })
    const result = await fetchSafeText('https://example.com/paper', {
      fetcher,
      resolveHost: publicDns,
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 0,
    })
    expect(result.text).toBe('ok')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('pins each redirect hop to its independently validated addresses', async () => {
    const resolveHost = vi.fn(async (hostname: string): Promise<readonly string[]> => hostname === 'one.example'
      ? ['8.8.8.8']
      : ['1.1.1.1'])
    const observed: string[][] = []
    const fetcher = vi.fn(async (url: string, _init: RequestInit, addresses: readonly string[]) => {
      observed.push([...addresses])
      return url.includes('one.example')
        ? new Response('', { status: 302, headers: { location: 'https://two.example/paper' } })
        : new Response('done')
    })
    const result = await fetchSafeText('https://one.example/start', {
      fetcher,
      resolveHost,
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 2,
    })
    expect(result.text).toBe('done')
    expect(observed).toEqual([['8.8.8.8'], ['1.1.1.1']])
    expect(resolveHost).toHaveBeenCalledTimes(2)
  })

  it('enforces an exact host allow-list on every redirect hop', async () => {
    const sameHostFetcher = vi.fn(async (url: string) => url.endsWith('/start')
      ? new Response('', { status: 302, headers: { location: '/final' } })
      : new Response('done'))
    const result = await fetchSafeText('https://provider.example/start', {
      fetcher: sameHostFetcher,
      resolveHost: publicDns,
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 2,
      allowedHosts: ['PROVIDER.EXAMPLE.'],
    })
    expect(result.finalUrl).toBe('https://provider.example/final')
    expect(sameHostFetcher).toHaveBeenCalledTimes(2)

    const crossHostFetcher = vi.fn(async () => new Response('', {
      status: 302,
      headers: { location: 'https://unrelated.example/final' },
    }))
    await expect(fetchSafeText('https://provider.example/start', {
      fetcher: crossHostFetcher,
      resolveHost: publicDns,
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 2,
      allowedHosts: ['provider.example'],
    })).rejects.toMatchObject({ code: 'blocked-host' })
    expect(crossHostFetcher).toHaveBeenCalledTimes(1)
  })

  it('rejects HTTPS-to-HTTP redirect downgrades', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 302, headers: { location: 'http://example.com/plain' } }))
    await expect(fetchSafeText('https://example.com/paper', {
      fetcher,
      resolveHost: publicDns,
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 3,
    })).rejects.toMatchObject({ code: 'blocked-host' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('rejects declared and streamed oversized responses', async () => {
    const declared = async (): Promise<Response> => new Response('small', { headers: { 'content-length': '9999' } })
    await expect(fetchSafeText('https://example.com', {
      fetcher: declared,
      resolveHost: publicDns,
      timeoutMs: 1_000,
      maxResponseBytes: 100,
      maxRedirects: 0,
    })).rejects.toMatchObject({ code: 'response-too-large' })

    const streamed = async (): Promise<Response> => new Response('x'.repeat(101))
    await expect(fetchSafeText('https://example.com', {
      fetcher: streamed,
      resolveHost: publicDns,
      timeoutMs: 1_000,
      maxResponseBytes: 100,
      maxRedirects: 0,
    })).rejects.toMatchObject({ code: 'response-too-large' })
  })

  it('returns bounded public text', async () => {
    const result = await fetchSafeText('https://example.com/paper', {
      fetcher: async () => new Response('<title>Example</title>', { headers: { 'content-type': 'text/html' } }),
      resolveHost: publicDns,
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 0,
    })
    expect(result.text).toContain('Example')
  })

  it('applies the deadline while reading a stalled response body', async () => {
    const stalled = async (): Promise<Response> => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('partial'))
      },
    }))

    await expect(fetchSafeText('https://example.com/paper', {
      fetcher: stalled,
      resolveHost: publicDns,
      timeoutMs: 25,
      maxResponseBytes: 10_000,
      maxRedirects: 0,
    })).rejects.toMatchObject({ code: 'timeout' })
  })

  it('cancels rejected response bodies', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true
      },
    })
    await expect(fetchSafeText('https://example.com/paper', {
      fetcher: async () => new Response(body, { status: 503 }),
      resolveHost: publicDns,
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 0,
    })).rejects.toMatchObject({ code: 'http-error' })
    expect(cancelled).toBe(true)
  })
})
