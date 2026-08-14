# Source Layout

The source entries are:

- `src/index.ts`: Loader-facing plugin namespace and public exports;
- `src/config.ts`: serializable schema, resolved defaults, and configuration types;
- `src/runtime.ts`: fakeable host boundary and Cordis activation;
- `src/invariant.ts`: package-owned invariant companion.
- `src/extractor.ts`: citation normalization, locations, and proximity associations;
- `src/network.ts`: bounded SSRF-aware HTTP transport;
- `src/verifier.ts`: provider adapters and status semantics;
- `src/tool.ts`: `citeguard_check` schema and receipt rendering;
- `src/cli.ts`: standalone CLI boundary.

Keep the baseline files focused. As the plugin grows, use these project-root conventions:

- extend `src/config.ts` rather than hiding deployment choices in implementation constants;
- extend `src/runtime.ts` with fakeable process, clock, transport, or UI boundaries;
- add `src/<feature>/` for cohesive product capabilities such as commands, providers, renderers, or projections;
- add `src/services/` only when the package actually defines one or more Cordis services.

Create a directory only when production code needs it. Name feature directories after the capability they own rather than copying another plugin's product-specific names. Keep `src/index.ts` as the Loader boundary instead of turning it into an unstructured implementation file.
