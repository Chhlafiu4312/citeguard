#!/usr/bin/env node
/** Standalone CiteGuard command-line interface. */

import { readFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveConfig, type NetworkMode } from './config.ts'
import { checkCitations, type CiteGuardReport, type VerificationStatus } from './verifier.ts'
import { formatCiteGuardReport } from './tool.ts'

/** Fakeable CLI environment. */
export interface CliEnvironment {
  readonly readStdin: () => Promise<string>
  readonly readFile: (path: string) => Promise<string>
  readonly stdout: (value: string) => void
  readonly stderr: (value: string) => void
}

const HELP = `CiteGuard — citation extraction and bounded verification

Usage:
  citeguard --file draft.md [--online] [--full] [--json]
  citeguard --text "10.1234/example" [--online] [--json]
  cat draft.md | citeguard [--online]

Options:
  --online              Contact Crossref/arXiv metadata providers.
  --full                Also allow SSRF-checked arbitrary URL requests (implies --online).
  --json                Print the stable JSON receipt.
  --fail-on <statuses>  Comma-separated statuses that cause exit code 1.
  --help                Show this help.
`

function defaultEnvironment(): CliEnvironment {
  return {
    readStdin: async () => {
      const chunks: Buffer[] = []
      for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      return Buffer.concat(chunks).toString('utf8')
    },
    readFile: path => readFile(path, 'utf8'),
    stdout: value => { process.stdout.write(value) },
    stderr: value => { process.stderr.write(value) },
  }
}

interface ParsedArguments {
  file: string | null
  text: string | null
  online: boolean
  networkMode: NetworkMode
  json: boolean
  help: boolean
  failOn: ReadonlySet<VerificationStatus>
}

const STATUSES = new Set<VerificationStatus>(['verified', 'reachable', 'unverified', 'invalid', 'mismatch', 'unreachable', 'blocked'])

function parseArguments(argv: readonly string[]): ParsedArguments {
  let file: string | null = null
  let text: string | null = null
  let online = false
  let networkMode: NetworkMode = 'metadata'
  let json = false
  let help = false
  let failOn = new Set<VerificationStatus>()
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--file' || argument === '--text' || argument === '--fail-on') {
      const value = argv[index + 1]
      if (value === undefined) throw new TypeError(`${argument} requires a value`)
      index += 1
      if (argument === '--file') file = value
      else if (argument === '--text') text = value
      else {
        failOn = new Set(value.split(',').map(item => item.trim()).filter((item): item is VerificationStatus => STATUSES.has(item as VerificationStatus)))
        if (failOn.size === 0 && value.trim().length > 0) throw new TypeError('--fail-on did not contain a supported status')
      }
    } else if (argument === '--online') online = true
    else if (argument === '--full') {
      online = true
      networkMode = 'full'
    } else if (argument === '--json') json = true
    else if (argument === '--help' || argument === '-h') help = true
    else throw new TypeError(`unknown argument ${JSON.stringify(argument)}`)
  }
  if (file !== null && text !== null) throw new TypeError('choose either --file or --text')
  return { file, text, online, networkMode, json, help, failOn }
}

function failing(report: CiteGuardReport, statuses: ReadonlySet<VerificationStatus>): boolean {
  return report.results.some(result => statuses.has(result.status))
}

/** Run the CLI and return a process exit code. */
export async function runCli(argv: readonly string[], environment: CliEnvironment = defaultEnvironment()): Promise<number> {
  let args: ParsedArguments
  try {
    args = parseArguments(argv)
  } catch (error) {
    environment.stderr(`${error instanceof Error ? error.message : String(error)}\n\n${HELP}`)
    return 2
  }
  if (args.help) {
    environment.stdout(HELP)
    return 0
  }
  try {
    const input = args.file === null ? (args.text ?? await environment.readStdin()) : await environment.readFile(args.file)
    const report = await checkCitations(input, resolveConfig({ networkMode: args.networkMode }), { online: args.online })
    environment.stdout(`${args.json ? JSON.stringify(report, null, 2) : formatCiteGuardReport(report)}\n`)
    return failing(report, args.failOn) ? 1 : 0
  } catch (error) {
    environment.stderr(`${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
}

let invoked = false
try {
  invoked = process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
} catch {
  invoked = false
}
if (invoked) process.exitCode = await runCli(process.argv.slice(2))
