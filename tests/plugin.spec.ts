import { describe, expect, it, vi } from 'vitest'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { Context } from '@deepseek-ai/cordis'
import * as plugin from '../src/index.ts'
import * as invariant from '../src/invariant.ts'
import { createPluginHarness } from './harness.ts'

describe('dsh-citeguard', () => {
  it('preserves the function-plugin namespace through Loader unwrapping', () => {
    expect('default' in plugin).toBe(false)

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(plugin) as Record<string, unknown>
    expect(unwrapped).toBe(plugin)
    expect(unwrapped.name).toBe('citeguard')
    expect(unwrapped.inject).toEqual(['tools'])
    expect(unwrapped.Config).toBeDefined()
    expect(typeof unwrapped.apply).toBe('function')
  })

  it('applies with schema defaults', async () => {
    const harness = await createPluginHarness()
    expect(harness.info).toHaveBeenCalledWith('CiteGuard enabled (networkMode=metadata)')
    expect(harness.tools.has('citeguard_check')).toBe(true)
    const tool = harness.tools.get('citeguard_check')
    const value = await tool?.execute(
      { text: 'The draft cites 10.1234/example.', online: false },
      { signal: new AbortController().signal } as never,
    ) as { checkedCitations?: number }
    expect(value.checkedCitations).toBe(1)
    await harness.dispose()
    expect(harness.tools.size).toBe(0)
  })

  it('accepts composition configuration', async () => {
    const harness = await createPluginHarness({ enabled: false })
    expect(harness.info).toHaveBeenCalledWith('CiteGuard disabled')
    expect(harness.tools.size).toBe(0)
    await harness.dispose()
  })

  it('registers the invariant companion through its local host contract', async () => {
    const ctx = new Context()
    const unregister = vi.fn()
    const register = vi.fn<(packageName: string, installer: unknown) => () => void>(() => unregister)
    const removeService = ctx.provide('invariants', { register })

    const fiber = await ctx.plugin(invariant)
    expect(register).toHaveBeenCalledTimes(1)
    expect(register.mock.calls[0]?.[0]).toBe('dsh-citeguard')
    expect(typeof register.mock.calls[0]?.[1]).toBe('function')

    await fiber.dispose()
    expect(unregister).toHaveBeenCalledTimes(1)
    await removeService()
  })
})
