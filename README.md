# CiteGuard

English | [中文](README.zh.md)

[![CI](https://github.com/Chhlafiu4312/citeguard/actions/workflows/ci.yml/badge.svg)](https://github.com/Chhlafiu4312/citeguard/actions/workflows/ci.yml)
[![License: BSD-3-Clause](https://img.shields.io/badge/license-BSD--3--Clause-blue.svg)](LICENSE)

CiteGuard is a citation linter and bounded metadata verifier for DeepSeek Harness. It extracts DOI, arXiv, URL, and Markdown citations from drafts, checks what can be checked mechanically, and labels every conclusion at the right confidence level.

It never turns “the link responded” into “the claim is true.”

## Why it exists

AI-generated citations fail in several different ways: malformed identifiers, invented papers, wrong titles, dead links, or a real paper placed beside a claim it does not support. CiteGuard catches the mechanical failures while preserving a clear boundary around semantic review.

```text
draft ──> extract + normalize ──> offline validation ──> bounded provider check
                                       │                        │
                                       └── proximity labels ────┴──> evidence receipt
```

## What you get

- DOI, arXiv, HTTP URL, and Markdown-link extraction with normalization and deduplication.
- Stable line, column, context, and same-sentence proximity associations for every citation.
- DOI metadata from the fixed Crossref API and arXiv metadata from the fixed arXiv API, with redirects locked to the original provider host.
- Explicit title-similarity mismatch detection for descriptive Markdown links.
- Arbitrary URL checks only when `networkMode=full` is explicitly enabled.
- SSRF defenses: HTTP-only schemes, no URL credentials, canonical IPv4/IPv6 private and special-purpose range rejection, DNS answer validation, per-redirect validation, redirect caps, one end-to-end deadline, prompt cancellation of rejected response bodies, and response-size limits.
- A model-callable `citeguard_check` tool, standalone CLI, stable JSON receipt, and reusable TypeScript API.
- Citation and input caps that prevent a draft from causing unbounded network work.

The precise evidence contract is documented in [docs/design.md](docs/design.md).

## Quick start

Requirements for building from source: Node.js 22.19 or newer and pnpm.

```sh
pnpm install
pnpm run prepare
node lib/cli.js --text "This result follows prior work (10.1234/example)."
```

The CLI is offline by default. Enable only fixed metadata providers, or explicitly allow arbitrary public URLs:

```sh
node lib/cli.js --file draft.md --online
node lib/cli.js --file draft.md --full --json --fail-on mismatch,unreachable,blocked
```

Exit codes are `0` for success, `1` when a requested `--fail-on` status occurs, and `2` for invalid input, I/O, or fatal verification setup errors.

## DeepSeek Harness installation

The source is published on GitHub. The npm package remains unpublished. Run these commands in a local terminal, not in the Harness chat input. A global `dsh` command is not required.

```sh
npx -y @deepseek-ai/dsh plugin --profile web add https://github.com/Chhlafiu4312/citeguard/releases/download/v0.1.7/dsh-citeguard-0.1.7.tgz
npx -y @deepseek-ai/dsh --profile web --dump-config

# Restart a running Web UI after installation.
npx -y @deepseek-ai/dsh web

# Or build and install a local tarball.
pnpm pack
npx -y @deepseek-ai/dsh plugin --profile web add ./dsh-citeguard-0.1.7.tgz
```

The commands above install into the Web UI's `web` profile. For terminal-only use, replace `web` with `headless`. The package contributes [cordis.patch.yml](cordis.patch.yml), which registers `citeguard`. An optional `dsh-citeguard/invariant` companion remains available for custom profiles that mount the Harness `invariants` service; the stock `headless` and `web` profiles do not mount it.

Once active, the Harness tool is:

```text
citeguard_check({ text, online? })
```

The tool defaults `online` to `true` but remains constrained by the plugin's `networkMode`. Pass `online: false` for deterministic offline extraction.

## Status meanings

| Status | Meaning |
|---|---|
| `verified` | A DOI or arXiv identifier resolved at its constrained metadata provider; any explicit title passed the configured similarity threshold. |
| `reachable` | An explicitly permitted arbitrary URL returned a successful bounded response. |
| `mismatch` | Provider metadata resolved, but an explicit descriptive link label did not resemble the provider title enough. |
| `unverified` | Syntax was accepted, but policy or offline mode prevented a provider request. |
| `invalid` | The identifier or URL failed local syntax validation. |
| `unreachable` | DNS, timeout, provider, or HTTP failure prevented verification. |
| `blocked` | The request violated network safety policy or resource limits. |

None of these statuses proves semantic entailment, research quality, or factual truth. Claim associations mean only “citation appears in the same sentence.”

## Configuration

| Field | Default | Purpose |
|---|---:|---|
| `enabled` | `true` | Register the `citeguard_check` tool. |
| `networkMode` | `metadata` | `off`, fixed-provider `metadata`, or SSRF-checked `full`. |
| `timeoutMs` | `8000` | One end-to-end deadline covering DNS, every redirect, headers, and complete response-body consumption. |
| `maxResponseBytes` | `1048576` | Maximum accepted response body. |
| `maxRedirects` | `4` | Maximum validated redirects. |
| `minTitleSimilarity` | `0.55` | Token-set similarity required for an explicit title label. |
| `maxTextChars` | `200000` | Maximum draft length per invocation. |
| `maxCitations` | `100` | Maximum citations verified per invocation. |

The complete bundle defaults are in [cordis.patch.yml](cordis.patch.yml).

## Library API

```ts
import { extractCitations, checkCitations, resolveConfig } from 'dsh-citeguard'

const offline = extractCitations(draft)
const receipt = await checkCitations(draft, resolveConfig(), { online: false })
```

Network and extraction helpers are also exported at `dsh-citeguard/network` and `dsh-citeguard/extractor`.

## Security and limitations

- `metadata` mode contacts only Crossref and arXiv provider hosts; exact host allow-lists reject cross-provider redirects before DNS resolution, and arbitrary URLs remain unrequested.
- `full` mode is opt-in, validates every redirect target, and pins each connection to the exact public DNS answer set that passed validation.
- IPv4 and IPv6 literals and DNS answers are checked against canonical special-purpose subnets, including mapped and transition forms.
- Oversized, unsuccessful, cancelled, and timed-out response bodies are closed rather than left consuming a socket.
- Redirect response bodies are cancelled before missing, malformed, unsafe, or excessive targets are rejected.
- Custom injected fetch transports must connect only to the validated address set passed as their third argument; the built-in transport enforces this invariant.
- DNS validation and connection pinning reduce SSRF risk but cannot make remote content trustworthy.
- HTML parsing is intentionally shallow and does not execute scripts.
- Crossref and arXiv availability, rate limits, and metadata quality are outside CiteGuard's control.
- Title token overlap is a mismatch signal, not an authorship or plagiarism judgment.
- Human source reading remains required to decide whether evidence actually supports a claim.

Report vulnerabilities using [SECURITY.md](SECURITY.md). Do not publish private manuscripts or exploit targets in issues.

## Development

```sh
pnpm run verify:self-contained
pnpm run typecheck
pnpm test
pnpm run prepare
pnpm run build
```

Tests use deterministic fake providers and make no real network requests. They cover extraction, deduplication, title checks, status wording, SSRF rejection, provider host locking, end-to-end deadlines, redirect cancellation, size limits, Loader exports, registration disposal, and CLI behavior. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Status

Version `0.1.7` enforces one deadline across DNS and the complete redirect workflow and releases rejected redirect bodies promptly and is published at [Chhlafiu4312/citeguard](https://github.com/Chhlafiu4312/citeguard). Release tarballs include a SHA-256 checksum and GitHub build-provenance attestation. The package remains `private: true`; no npm registry publication is performed by the build.

BSD-3-Clause licensed. See [LICENSE](LICENSE).
