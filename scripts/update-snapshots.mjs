import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const result = spawnSync(process.execPath, [join(root, 'lib/cli.js'), '--text', 'Claim (10.1234/example).'], { encoding: 'utf8' })
if (result.error !== undefined || result.status !== 0 || result.stderr.length > 0) {
  console.error(result.error?.message ?? (result.stderr || `unexpected CiteGuard exit ${result.status}`))
  process.exit(1)
}
writeFileSync(join(root, 'tests/snapshots/citeguard-offline.md'), result.stdout)
console.log('updated tests/snapshots/citeguard-offline.md')
