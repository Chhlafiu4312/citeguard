# CiteGuard Design

## Objective

CiteGuard extracts machine-verifiable citations from AI-generated text, validates identifiers, optionally retrieves metadata from constrained providers, and reports which claims are merely adjacent to citations. It does not claim semantic entailment or truth.

## Plugin contract

- Package: `dsh-citeguard`
- Cordis id: `citeguard`
- Form: function plugin
- Roles: DSH tool, read-only metadata verifier, bundle
- Required service: `tools`
- Target profiles: Web and Headless
- Distribution: local and Git installation first; npm publication remains a separate decision

## Network defaults

Offline extraction is always available. DOI and arXiv metadata use fixed provider hosts when enabled. Arbitrary URL verification is disabled by default and, when enabled, rejects credentials in URLs, non-HTTP protocols, loopback names, canonical IPv4/IPv6 private or special-purpose subnets, unsafe redirects, and responses over configured byte limits. The request deadline remains active through complete response-body consumption, and rejected bodies are cancelled to release their underlying streams.

## Verification language

`verified` means an identifier resolved and available metadata agreed with explicit citation metadata. `reachable` means a URL responded. Neither status proves that a source supports a nearby claim. Claim-to-citation rows are proximity associations and are labeled accordingly.

## Invariant decision

The stock bundle does not install a runtime invariant. CiteGuard performs independent read-only checks and owns no durable cross-call relationship. The package still exports an optional companion for custom profiles that explicitly mount Harness's `invariants` service.

## Evidence

Unit tests cover DOI, arXiv, URL, Markdown, deduplication, title comparison, canonical IPv4/IPv6 SSRF rejection, redirect validation, body deadlines, stream cancellation, and report wording. Cordis tests cover registration and disposal. Stable CLI output has snapshots. A package check covers self-containment, types, tests, build, and archive contents.
