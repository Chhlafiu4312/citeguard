/** Size-limited HTTP transport with redirect-by-redirect SSRF validation. */

import { lookup } from 'node:dns/promises'
import { request as requestHttp } from 'node:http'
import { request as requestHttps } from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { Readable } from 'node:stream'

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

/** Fetch boundary injected by provider tests. The third argument is the validated, connection-pinned address set. */
export type FetchLike = (input: string, init: RequestInit, addresses: readonly string[]) => Promise<Response>

/** Bounded network request configuration. */
export interface SafeRequestOptions {
  readonly fetcher?: FetchLike
  readonly resolveHost?: ResolveHost
  readonly timeoutMs: number
  readonly maxResponseBytes: number
  readonly maxRedirects: number
  readonly signal?: AbortSignal
  readonly headers?: Readonly<Record<string, string>>
  /** Optional exact host allow-list, enforced again on every redirect hop. */
  readonly allowedHosts?: readonly string[]
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

interface SafeHttpTarget {
  readonly url: URL
  readonly addresses: readonly string[]
}

const NON_PUBLIC_IPV4 = new BlockList()
const NON_PUBLIC_IPV6 = new BlockList()

// Maintain these conservative SSRF deny-lists against the IANA IPv4 and IPv6
// Special-Purpose Address Registries. Globally reachable exceptions such as
// 192.0.0.9/32, 192.0.0.10/32, and 2001:3::/32 intentionally remain allowed.
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 29],
  ['192.0.0.8', 32],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) NON_PUBLIC_IPV4.addSubnet(network, prefix, 'ipv4')
NON_PUBLIC_IPV4.addRange('192.0.0.11', '192.0.0.255', 'ipv4')

for (const [network, prefix] of [
  ['::', 96],
  ['::', 128],
  ['::1', 128],
  ['::ffff:0.0.0.0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['100:0:0:1::', 64],
  ['2001::', 32],
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['5f00::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) NON_PUBLIC_IPV6.addSubnet(network, prefix, 'ipv6')

/** Return whether an address is globally routable enough for arbitrary citation checks. */
export function isPublicAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/gu, '')
  const family = isIP(normalized)
  if (family === 4) return !NON_PUBLIC_IPV4.check(normalized, 'ipv4')
  if (family === 6) return !NON_PUBLIC_IPV6.check(normalized, 'ipv6')
  return false
}

async function resolveSafeHttpTarget(input: string, resolver: ResolveHost, allowedHosts?: ReadonlySet<string>): Promise<SafeHttpTarget> {
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
  if (allowedHosts !== undefined && !allowedHosts.has(hostname)) {
    throw new NetworkGuardError('blocked-host', 'The citation host is not permitted by this request policy.')
  }
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
  return { url, addresses: [...new Set(addresses)] }
}

/** Validate protocol, credentials, host name, and every resolved address. */
export async function assertSafeHttpUrl(input: string, resolver: ResolveHost = defaultResolveHost): Promise<URL> {
  return (await resolveSafeHttpTarget(input, resolver)).url
}

function redirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function responseHeaders(rawHeaders: readonly string[]): Headers {
  const headers = new Headers()
  for (let index = 0; index < rawHeaders.length; index += 2) {
    headers.append(rawHeaders[index]!, rawHeaders[index + 1]!)
  }
  return headers
}

/** Connect only to an address from the exact DNS answer set already validated above. */
async function fetchPinned(input: string, init: RequestInit, addresses: readonly string[]): Promise<Response> {
  const url = new URL(input)
  const address = addresses[0]
  if (address === undefined) throw new NetworkGuardError('dns-failure', 'The citation host had no validated connection address.')
  const family = isIP(address)
  if (family === 0) throw new NetworkGuardError('dns-failure', 'The citation host returned an invalid connection address.')

  const lookupPinned: LookupFunction = (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address, family }])
    else callback(null, address, family)
  }
  const headers = new Headers(init.headers)
  if (!headers.has('accept-encoding')) headers.set('accept-encoding', 'identity')
  const request = url.protocol === 'https:' ? requestHttps : requestHttp

  return await new Promise<Response>((resolve, reject) => {
    const outgoing = request(url, {
      method: init.method ?? 'GET',
      headers: Object.fromEntries(headers.entries()),
      lookup: lookupPinned,
      signal: init.signal ?? undefined,
    }, (incoming) => {
      const status = incoming.statusCode
      if (status === undefined) {
        incoming.destroy()
        reject(new NetworkGuardError('http-error', 'Citation provider returned no HTTP status.'))
        return
      }
      const body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>
      resolve(new Response(body, {
        status,
        ...(incoming.statusMessage === undefined ? {} : { statusText: incoming.statusMessage }),
        headers: responseHeaders(incoming.rawHeaders),
      }))
    })
    outgoing.once('error', reject)
    outgoing.end()
  })
}

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) throw new NetworkGuardError('timeout', 'The citation request timed out or was cancelled.')
  return await new Promise((resolve, reject) => {
    const aborted = () => reject(new NetworkGuardError('timeout', 'The citation request timed out or was cancelled.'))
    signal.addEventListener('abort', aborted, { once: true })
    reader.read().then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted))
  })
}

async function boundedText(response: Response, maximum: number, signal: AbortSignal): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maximum) {
    await response.body?.cancel()
    throw new NetworkGuardError('response-too-large', `Response exceeds the ${maximum}-byte limit.`)
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const part = await readChunk(reader, signal)
      if (part.done) break
      total += part.value.byteLength
      if (total > maximum) {
        await reader.cancel()
        throw new NetworkGuardError('response-too-large', `Response exceeds the ${maximum}-byte limit.`)
      }
      chunks.push(part.value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
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
  const fetcher = options.fetcher ?? fetchPinned
  const resolver = options.resolveHost ?? defaultResolveHost
  const allowedHosts = options.allowedHosts === undefined
    ? undefined
    : new Set(options.allowedHosts.map(host => host.toLowerCase().replace(/\.$/u, '')))
  let current = input
  for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
    const safeTarget = await resolveSafeHttpTarget(current, resolver, allowedHosts)
    const safeUrl = safeTarget.url
    const deadline = AbortSignal.timeout(options.timeoutMs)
    const signal = options.signal === undefined ? deadline : AbortSignal.any([options.signal, deadline])
    let response: Response
    try {
      response = await fetcher(safeUrl.href, {
        method: 'GET',
        redirect: 'manual',
        ...(options.headers === undefined ? {} : { headers: options.headers }),
        signal,
      }, safeTarget.addresses)
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
      await response.body?.cancel()
      current = target.href
      continue
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new NetworkGuardError('http-error', `Citation provider returned HTTP ${response.status}.`)
    }
    return {
      finalUrl: safeUrl.href,
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      text: await boundedText(response, options.maxResponseBytes, signal),
    }
  }
  throw new NetworkGuardError('too-many-redirects', 'Citation URL exceeded the redirect limit.')
}
