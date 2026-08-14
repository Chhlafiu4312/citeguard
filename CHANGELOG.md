# Changelog

## 0.1.5 - 2026-08-15

- Replaced textual IPv6 prefix checks with canonical subnet matching, covering expanded loopback, unspecified, mapped, transition, local, and documentation address forms.
- Expanded conservative IPv4 special-purpose range rejection for arbitrary URL verification.
- Applied request deadlines through complete response-body consumption, including injected transport implementations.
- Cancelled oversized and unsuccessful response bodies to release sockets and streams promptly.
- Added regression coverage for IPv4/IPv6 bypass forms, stalled bodies, and error-body cancellation.

## 0.1.4 - 2026-08-15

- Replaced the Markdown-link regular expression with a bounded linear scanner to eliminate polynomial backtracking on adversarial input.
- Changed XML entity handling to decode exactly one layer and prevent double-unescaping provider metadata.
- Ignored malformed percent-encoded DOI links without aborting the full citation scan.
- Added regression coverage for adversarial incomplete links, one-layer XML decoding, and malformed DOI paths.

## 0.1.3 - 2026-08-15

- Resolved packed release archives to absolute paths before the Harness clean-profile smoke install.
- Recorded the failed-closed v0.1.2 release attempt; no v0.1.2 archive was published.

## 0.1.2 - 2026-08-15

- Pinned every GitHub Action to an immutable commit and added dependency review and CodeQL analysis.
- Added weekly Dependabot updates, ownership and contribution templates, and a code of conduct.
- Added a tag-to-version gate, clean-profile installation smoke test, SHA-256 checksum, and build provenance attestation to automated releases.

## 0.1.1 - 2026-08-14

- Pinned production HTTP(S) connections to the exact public DNS address set that passed SSRF validation.
- Revalidated and independently pinned every redirect hop.
- Added regression coverage for address-set propagation and per-hop DNS pinning.

## 0.1.0

- Added DOI, arXiv, URL, and Markdown citation extraction and normalization.
- Added constrained Crossref/arXiv metadata checks and explicit title mismatch detection.
- Added opt-in arbitrary URL verification with SSRF, redirect, timeout, and response-size protections.
- Added the `citeguard_check` DSH tool, standalone CLI, public library API, and lifecycle tests.
- Kept the optional invariant companion out of the default bundle so stock Harness Web and Headless profiles activate without an `invariants` service.
