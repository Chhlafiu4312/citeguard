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
})
