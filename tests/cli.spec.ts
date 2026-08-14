import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { runCli, type CliEnvironment } from '../src/cli.ts'

function environment(stdin = ''): { env: CliEnvironment; stdout: string[]; stderr: string[] } {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    stdout,
    stderr,
    env: {
      readStdin: async () => stdin,
      readFile: async path => path === 'draft.md' ? '10.1234/example' : '',
      stdout: value => { stdout.push(value) },
      stderr: value => { stderr.push(value) },
    },
  }
}

describe('citeguard CLI', () => {
  it('keeps the offline Markdown receipt stable', async () => {
    const io = environment()
    const exitCode = await runCli(['--text', 'Claim (10.1234/example).'], io.env)
    const expected = await readFile(new URL('./snapshots/citeguard-offline.md', import.meta.url), 'utf8')
    expect(exitCode).toBe(0)
    expect(io.stdout.join('')).toBe(expected)
  })
  it('prints an offline JSON receipt', async () => {
    const io = environment()
    const exitCode = await runCli(['--text', '10.1234/example', '--json'], io.env)
    expect(exitCode).toBe(0)
    expect(JSON.parse(io.stdout.join(''))).toMatchObject({ checkedCitations: 1, networkUsed: false })
  })

  it('supports CI failure thresholds', async () => {
    const io = environment('10.1234/example')
    const exitCode = await runCli(['--fail-on', 'unverified'], io.env)
    expect(exitCode).toBe(1)
  })

  it('rejects conflicting input modes', async () => {
    const io = environment()
    const exitCode = await runCli(['--file', 'draft.md', '--text', 'x'], io.env)
    expect(exitCode).toBe(2)
    expect(io.stderr.join('')).toContain('choose either')
  })
})
