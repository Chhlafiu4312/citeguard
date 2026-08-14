# Changelog

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
