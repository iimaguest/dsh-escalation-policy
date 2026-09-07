/**
 * The escalation seam through a real cordis.yml Loader composition (the
 * non-unit REAL-composition test policy): the Loader mounts the default-export
 * service beside the session, system-prompt, projection, and command
 * registries, then a scoped live agent drives the seam end to end. Asserts the
 * durable audit pair, the deterministic policy gate, the `/escalation`
 * command settlement and injected notice, the `escalation` projection fold,
 * and the verbatim cache-safe policy context — all through the composed
 * plugin rather than a hand-wired suite.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createScope } from '@deepseek-ai/dsh-scope'
import EscalationService from '@deepseek-ai/dsh-escalation-policy'

const DENY_SENTENCE = 'Escalation policy: deny. Sandbox escalation retries (sandbox_permissions with a justification) are auto-denied in this session — do not request sandbox escalation (do not set sandbox_permissions).'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('escalation seam through a real cordis.yml Loader composition', () => {
  it('answers, gates, projects, and commands through the composed plugins', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-escalation-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-system-prompt'",
      '  config:',
      "    persona: ''",
      "- name: '@deepseek-ai/dsh-escalation-policy'",
      '  config:',
      '    policy: ask',
      "- name: '@deepseek-ai/dsh-session-projection'",
      "- name: '@deepseek-ai/dsh-commands'",
      '',
    ].join('\n'))

    const ctx = new Context()
    context = ctx
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-session', SessionStore],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-escalation-policy', EscalationService],
      ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
      ['@deepseek-ai/dsh-commands', CommandRuntime],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()

    // A scoped agent over a live session opened inside a turn (request()'s
    // turn-enclosure precondition) — the command executor's addressing shape.
    const session: Session = ctx.sessions.create(SessionId('esc-loader-agent'))
    session.append('turn/start', { turn: 1 })
    const inject = vi.fn<Agent['inject']>()
    const agent = { id: session.id, session, inject } as unknown as Agent
    await ctx.plugin(Object.assign((inner: Context) => { createScope(inner, agent) }, { inject: ['commands'] }))

    // (1) ask with no answerer: fail closed, durable asked/decided audit pair
    // (the fresh session also carries its pinned default `escalation/policy`).
    expect(await ctx.escalation.request({
      agent, toolName: 'bash', target: 'workspace-write', justification: 'needs workspace writes',
    })).toBe('unavailable')
    const audit = session.snapshotEvents().filter(event =>
      event.type === 'escalation/asked' || event.type === 'escalation/decided')
    expect(audit.map(event => event.type)).toEqual(['escalation/asked', 'escalation/decided'])
    expect(audit[0]?.data).toMatchObject({
      toolName: 'bash', target: 'workspace-write',
      reason: 'escalate sandbox to workspace-write: needs workspace writes',
    })
    expect(audit[1]?.data).toMatchObject({ outcome: 'unavailable' })

    // (2) the /escalation command switches the per-session policy: the
    // settlement is the user-visible write-path contract, the notice reaches
    // the model, the projection folds, and the cache-safe context states the
    // deterministic denial verbatim.
    const execution = await ctx.commands.execute(agent, '/escalation deny', [], new AbortController().signal)
    expect(execution?.result).toEqual({ kind: 'success', text: 'escalation policy deny' })
    expect(ctx.escalation.overrideOf(session)).toBe('deny')
    expect(inject.mock.calls[0]?.[0]).toMatchObject({
      content: [{
        type: 'text',
        text: 'The escalation policy changed from "ask" to "deny" (changed by the user).',
      }],
    })
    expect(ctx.sessionProjections.snapshot(session).values.escalation).toMatchObject({ currentValue: 'deny' })
    const contextText = (await ctx.systemPrompt.assemble({ agent }))
      .contexts.find(entry => entry.name === 'escalation:policy')?.text
    expect(contextText).toBe(DENY_SENTENCE)

    // (3) the deterministic gate never consults an answerer, and an allow
    // override grants without one.
    const consulted = vi.fn()
    ctx.on('escalation/request', (_req, next) => { consulted(); return next() })
    await expect(ctx.escalation.request({
      agent, toolName: 'bash', target: 'workspace-write', justification: 'x',
    })).resolves.toBe('rejected')
    expect(consulted).not.toHaveBeenCalled()
    await ctx.commands.execute(agent, '/escalation allow', [], new AbortController().signal)
    await expect(ctx.escalation.request({
      agent, toolName: 'bash', target: 'danger-full-access', justification: 'y',
    })).resolves.toBe('allowed-once')
    expect(consulted).not.toHaveBeenCalled()
  }, 20_000)
})
