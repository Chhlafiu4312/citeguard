/** DeepSeek Harness tool definition and evidence-bound report rendering. */

import { defineTool, type JsonValue, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ResolvedConfig } from './config.ts'
import { checkCitations, type CiteGuardReport, type VerificationDependencies } from './verifier.ts'

/** Render a compact receipt whose language does not overstate verification. */
export function formatCiteGuardReport(report: CiteGuardReport): string {
  const lines = [
    '# CiteGuard receipt',
    '',
    `- Citations checked: ${report.checkedCitations}`,
    `- Verified identifiers: ${report.counts.verified}`,
    `- Reachable URLs: ${report.counts.reachable}`,
    `- Mismatches: ${report.counts.mismatch}`,
    `- Unverified: ${report.counts.unverified}`,
    `- Unreachable: ${report.counts.unreachable}`,
    `- Blocked by network policy: ${report.counts.blocked}`,
  ]
  if (report.omittedCitations > 0) lines.push(`- Omitted by configured cap: ${report.omittedCitations}`)
  if (report.results.length > 0) {
    lines.push('', '## Citations')
    for (const result of report.results) {
      const title = result.metadata?.title === null || result.metadata?.title === undefined ? '' : ` — ${result.metadata.title}`
      lines.push(`- **${result.status}** \`${result.citation.normalized}\`${title}`)
      lines.push(`  ${result.reason}`)
    }
  }
  if (report.associations.length > 0) {
    lines.push('', '## Proximity-only claim associations')
    for (const association of report.associations.slice(0, 20)) {
      lines.push(`- ${association.citationIds.join(', ')}: ${association.claim}`)
    }
  }
  lines.push('', `Limitation: ${report.limitation}`)
  return lines.join('\n')
}

/** Create the `citeguard_check` tool. */
export function createCiteGuardTool(config: ResolvedConfig, dependencies: VerificationDependencies = {}): ToolDefinition {
  return defineTool({
    name: 'citeguard_check',
    description: 'Extract DOI, arXiv, web, and Markdown citations; optionally resolve metadata under a constrained network policy. Resolution never proves that a source supports a claim.',
    parameters: {
      text: {
        type: 'string',
        required: true,
        description: 'Draft, answer, or bibliography text to inspect.',
      },
      online: {
        type: 'boolean',
        description: 'Contact providers allowed by plugin configuration. Defaults to true; set false for deterministic offline extraction.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: formatCiteGuardReport(value as unknown as CiteGuardReport) }],
      presentationMeta: (_args, value) => {
        const report = value as unknown as CiteGuardReport
        return { checked: report.checkedCitations, verified: report.counts.verified, mismatches: report.counts.mismatch, blocked: report.counts.blocked }
      },
    },
    execute: (args, context) => checkCitations(args.text, config, { online: args.online ?? true, signal: context.signal }, dependencies) as unknown as Promise<JsonValue>,
    isConcurrencySafe: () => true,
  })
}
