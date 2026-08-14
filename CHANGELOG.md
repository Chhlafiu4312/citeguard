# Changelog

## 0.1.0

- Added DOI, arXiv, URL, and Markdown citation extraction and normalization.
- Added constrained Crossref/arXiv metadata checks and explicit title mismatch detection.
- Added opt-in arbitrary URL verification with SSRF, redirect, timeout, and response-size protections.
- Added the `citeguard_check` DSH tool, standalone CLI, public library API, and lifecycle tests.
- Kept the optional invariant companion out of the default bundle so stock Harness Web and Headless profiles activate without an `invariants` service.
