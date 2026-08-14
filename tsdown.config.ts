import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'lib/types/index.js',
    invariant: 'lib/types/invariant.js',
    cli: 'lib/types/cli.js',
    extractor: 'lib/types/extractor.js',
    network: 'lib/types/network.js',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  unbundle: true,
  dts: false,
  clean: false,
})
