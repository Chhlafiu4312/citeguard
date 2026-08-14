/** Size-limited HTTP transport with redirect-by-redirect SSRF validation. */

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/** Stable failure categories exposed in verification receipts. */
export type NetworkFailureCode = 'invalid-url' | 'blocked-host' | 'dns-failure' | 'too-many-redirects' | 'response-too-large' | 'http-error' | 'timeout'

/** Expected network policy failure. */
export class NetworkGuardError extends Error {
  constructor(readonly code: NetworkFailureCode, message: string) {
    super(message)
    this.name = 'NetworkGuardError'
  }
}

/** DNS boundary injected by security tests. */
export type ResolveHost = (hostname: string) => Promise<readonly string[]>

/** Fetch boundary injected by provider tests. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/** Bounded network request configuration. */
export interface SafeRequestOptions {
  readonly fetcher?: FetchLike
  readonly resolveHost?: ResolveHost
  readonly timeoutMs: number
  readonly maxResponseBytes: number
  readonly maxRedirects: number
  readonly signal?: AbortSignal
  readonly headers?: Readonly<Record<string, string>>
}

/** Text response returned only after all policy checks pass. */
export interface SafeTextResponse {
  readonly finalUrl: string
  readonly status: number
  readonly contentType: string
  readonly text: string
}

async function defaultResolveHost(hostname: string): Promise<readonly string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true })
  return records.map(record => record.address)
}

function publicIpv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return false
  const [a = 0, b = 0, c = 0] = octets
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && ((b === 0 && (c === 0 || c === 2)) || b === 168)) return false
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}

function publicIpv6(address: string): boolean {
  const value = address.toLowerCase().replace(/^\[|\]$/gu, '')
  if (value === '::' || value === '::1') return false
  if (value.startsWith('fc') || value.startsWith('fd') || /^fe[89ab]/u.test(value)) return false
  if (value.startsWith('ff') || value.startsWith('2001:db8:') || value.startsWith('::ffff:')) return false
  return true
}

/** Return whether an address is globally routable enough for arbitrary citation checks. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return publicIpv4(address)
  if (family === 6) return publicIpv6(address)
  return false
}

/** Validate protocol, credentials, host name, and every resolved address. */
export async function assertSafeHttpUrl(input: string, resolver: ResolveHost = defaultResolveHost): Promise<URL> {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new NetworkGuardError('invalid-url', 'The citation URL is not valid.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new NetworkGuardError('invalid-url', 'Only HTTP and HTTPS citation URLs are allowed.')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new NetworkGuardError('blocked-host', 'Credentials in citation URLs are not allowed.')
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, '')
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new NetworkGuardError('blocked-host', 'Local host names are not allowed.')
  }
  const literalFamily = isIP(hostname.replace(/^\[|\]$/gu, ''))
  let addresses: readonly string[]
  if (literalFamily !== 0) {
    addresses = [hostname.replace(/^\[|\]$/gu, '')]
  } else {
    try {
      addresses = await resolver(hostname)
    } catch {
      throw new NetworkGuardError('dns-failure', 'The citation host could not be resolved safely.')
    }
  }
  if (addresses.length === 0 || addresses.some(address => !isPublicAddress(address))) {
    throw new NetworkGuardError('blocked-host', 'The citation host resolves to a private or reserved address.')
  }
  url.hostname = hostname
  return url
}

function redirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

async function boundedText(response: Response, maximum: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maximum) {
    throw new NetworkGuardError('response-too-large', `Response exceeds the ${maximum}-byte limit.`)
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const part = await reader.read()
    if (part.done) break
    total += part.value.byteLength
    if (total > maximum) {
      await reader.cancel()
      throw new NetworkGuardError('response-too-large', `Response exceeds the ${maximum}-byte limit.`)
    }
    chunks.push(part.value)
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(joined)
}

/** Fetch text with manual redirects so every target receives the same SSRF checks. */
export async function fetchSafeText(input: string, options: SafeRequestOptions): Promise<SafeTextResponse> {
  const fetcher = options.fetcher ?? globalThis.fetch
  const resolver = options.resolveHost ?? defaultResolveHost
  let current = input
  for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
    const safeUrl = await assertSafeHttpUrl(current, resolver)
    const deadline = AbortSignal.timeout(options.timeoutMs)
    const signal = options.signal === undefined ? deadline : AbortSignal.any([options.signal, deadline])
    let response: Response
    try {
      response = await fetcher(safeUrl.href, {
        method: 'GET',
        redirect: 'manual',
        ...(options.headers === undefined ? {} : { headers: options.headers }),
        signal,
      })
    } catch (error) {
      if (signal.aborted) throw new NetworkGuardError('timeout', 'The citation request timed out or was cancelled.')
      throw new NetworkGuardError('http-error', error instanceof Error ? error.message : 'The citation request failed.')
    }
    if (redirect(response.status)) {
      const location = response.headers.get('location')
      if (location === null) throw new NetworkGuardError('http-error', 'Redirect response did not include a location.')
      if (hop === options.maxRedirects) throw new NetworkGuardError('too-many-redirects', 'Citation URL exceeded the redirect limit.')
      const target = new URL(location, safeUrl)
      if (safeUrl.protocol === 'https:' && target.protocol === 'http:') {
        throw new NetworkGuardError('blocked-host', 'HTTPS citation redirects may not downgrade to HTTP.')
      }
      current = target.href
      continue
    }
    if (!response.ok) throw new NetworkGuardError('http-error', `Citation provider returned HTTP ${response.status}.`)
    return {
      finalUrl: safeUrl.href,
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      text: await boundedText(response, options.maxResponseBytes),
    }
  }
  throw new NetworkGuardError('too-many-redirects', 'Citation URL exceeded the redirect limit.')
}
