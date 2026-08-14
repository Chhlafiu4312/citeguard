# Security Policy

CiteGuard accepts attacker-controlled URLs and research text. Please do not place private manuscripts, live credentials, or real internal-network targets in a public issue.

Report SSRF bypasses, redirect-policy bypasses, response-limit failures, unsafe parsing, or misleading verification language privately to the repository owner. Include the affected version and a minimal synthetic reproduction using documentation-only or local fake addresses.

Supported security fixes currently target the latest `0.1.x` release line. Provider outages and ordinary metadata errors are not vulnerabilities unless CiteGuard reports them at a stronger status than the evidence supports.

Starting with `0.1.3`, release tarballs include a SHA-256 checksum and GitHub build-provenance attestation. Verify the current archive with `sha256sum -c` and `gh attestation verify dsh-citeguard-0.1.6.tgz --repo Chhlafiu4312/citeguard` before installing it in a sensitive environment.
