# Contributing

Contributions are welcome for citation formats, provider parsing, false-positive reductions, security hardening, and DSH compatibility.

1. Describe the expected evidence level and include a synthetic fixture.
2. Keep provider tests offline through injected fetch and DNS boundaries.
3. Add a focused test for every parser, status, redirect, or address-policy change.
4. Never claim that identifier resolution or URL reachability proves a nearby statement.
5. Run the full verification sequence in [README.md](README.md).

Changes to network defaults, status definitions, or resource caps require matching updates to [docs/design.md](docs/design.md) and [cordis.patch.yml](cordis.patch.yml).
