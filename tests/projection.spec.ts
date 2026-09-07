/**
 * The `escalation` projection unit and the `/escalation` command: mounting the
 * escalation service beside the projection registry serves the whole select
 * (three policy options + effective current value) folded from
 * `escalation/policy` over the composition default; the command child
 * registers `/escalation` whose handler switches through `setPolicy` (bare
 * invocation reports, unknown names error); compositions without either
 * registry are unaffected; unmounting the service removes the key (HMR
 * safety).
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import EscalationService from '@deepseek-ai/dsh-escalation-policy'
import type { Config } from '@deepseek-ai/dsh-escalation-policy'

async function harness(config: Config = {}): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(EscalationService, config)
  return { ctx, session: ctx.sessions.create(SessionId('esc-projected')) }
}

/** Mint a scoped agent over a live session (the command executor's addressing shape). */
async function agentFor(ctx: Context, session: Session) {
  const inject = vi.fn<Agent['inject']>()
  const agent = { id: session.id, session, inject } as unknown as Agent
  await ctx.plugin(Object.assign((inner: Context) => { createScope(inner, agent) }, { inject: ['commands'] }))
  return { agent, inject }
}

describe('escalation projection unit', () => {
  it('serves the composition-default select', async () => {
    const { ctx, session } = await harness()
    const value = ctx.sessionProjections.snapshot(session).values.escalation
    expect(value).toMatchObject({ currentValue: 'ask' })
    expect(value?.options.map(option => option.value)).toEqual(['ask', 'deny', 'allow'])
  })

  it('folds the policy event and notifies the change feed per append', async () => {
    const { ctx, session } = await harness()
    const changes: { key: string; value: unknown; seq: number }[] = []
    ctx.sessionProjections.onChanged((_session, key, value, seq) => {
      changes.push({ key, value, seq })
    })
    session.append('escalation/policy', { policy: 'deny' })
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ key: 'escalation', value: { currentValue: 'deny' } })
    // Unrelated event: same-reference apply, no notification.
    session.append('turn/start', { turn: 1 })
    expect(changes).toHaveLength(1)
  })

  it('reflects an allow override over the composition default', async () => {
    const { ctx, session } = await harness({ policy: 'ask' })
    session.append('escalation/policy', { policy: 'allow' })
    const value = ctx.sessionProjections.snapshot(session).values.escalation
    expect(value?.currentValue).toBe('allow')
  })

  it('has no escalation key without the service, and drops it on unload (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const session = ctx.sessions.create(SessionId('esc-hmr'))
    expect('escalation' in ctx.sessionProjections.snapshot(session).values).toBe(false)
    const fiber = await ctx.plugin(EscalationService, {})
    expect(ctx.sessionProjections.snapshot(session).values.escalation).toMatchObject({ currentValue: 'ask' })
    await fiber.dispose()
    expect('escalation' in ctx.sessionProjections.snapshot(session).values).toBe(false)
  })
})

describe('/escalation command', () => {
  it('switches through setPolicy and logs the lifecycle pair', async () => {
    const { ctx, session } = await harness()
    const { agent, inject } = await agentFor(ctx, session)
    const execution = await ctx.commands.execute(agent, '/escalation deny', [], new AbortController().signal)
    expect(execution?.result).toEqual({ kind: 'success', text: 'escalation policy deny' })
    expect(ctx.escalation.overrideOf(session)).toBe('deny')
    expect(inject.mock.calls[0]?.[0]).toMatchObject({
      content: [{
        type: 'text',
        text: 'The escalation policy changed from "ask" to "deny" (changed by the user).',
      }],
    })
    const run = session.snapshotEvents().find(event => event.type === 'command/run')
    expect(run?.data).toMatchObject({ name: 'escalation', args: ' deny' })
  })

  it('reports the current policy and the vocabulary on bare invocation', async () => {
    const { ctx, session } = await harness()
    const { agent } = await agentFor(ctx, session)
    const execution = await ctx.commands.execute(agent, '/escalation', [], new AbortController().signal)
    expect(execution?.result).toEqual({
      kind: 'success',
      text: 'current escalation policy ask (available: ask, deny, allow)',
    })
  })

  it('rejects an unknown policy without touching the log', async () => {
    const { ctx, session } = await harness()
    const { agent } = await agentFor(ctx, session)
    const before = session.snapshotEvents().filter(event =>
      event.type !== 'command/run' && event.type !== 'command/done')
    const execution = await ctx.commands.execute(agent, '/escalation yolo', [], new AbortController().signal)
    // The error text carries the same no-self-labelling rule as the success
    // texts.
    expect(execution?.result).toEqual({
      kind: 'error',
      text: 'unknown escalation policy "yolo" (available: ask, deny, allow)',
    })
    expect(session.snapshotEvents().filter(event =>
      event.type !== 'command/run' && event.type !== 'command/done')).toEqual(before)
  })
})
