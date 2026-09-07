/**
 * The new-session escalation-policy default: a user-editable `escalation`
 * settings namespace that pins a durable `escalation/policy` event into each
 * genuinely fresh session (so replay reconstructs the policy the user picked,
 * independent of later setting changes). Without a settings provider the
 * composition config is the default; sessions that already recorded a policy
 * or were resumed from a seed are left untouched; remounting the service pins
 * sessions that predate it.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Session as SessionT } from '@deepseek-ai/dsh-session'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import EscalationService, { ESCALATION_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-escalation-policy'
import type { Config } from '@deepseek-ai/dsh-escalation-policy'

/** Writable memory provider for the escalation settings default lifecycle. */
class MemorySettings extends SettingsProvider {
  readonly doc: Record<string, unknown> = {}
  readonly writable = true

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

async function mounted(options: { config?: Config; withSettings?: boolean } = {}): Promise<{
  ctx: Context
  create: () => SessionT
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  if (options.withSettings !== false) await ctx.plugin(MemorySettings)
  await ctx.plugin(EscalationService, options.config ?? {})
  let counter = 0
  return {
    ctx,
    create: () => ctx.sessions.create(SessionId(`default-policy-session-${++counter}`)),
  }
}

describe('escalation default policy for new sessions', () => {
  it('pins the composition default into a genuinely fresh session at creation', async () => {
    const { ctx, create } = await mounted({ config: { policy: 'deny' } })
    const session = create()
    expect(ctx.escalation.overrideOf(session)).toBe('deny')
    expect(session.snapshotEvents().filter(event => event.type === 'escalation/policy')).toHaveLength(1)
  })

  it('pins the settings default and applies a later setting change to subsequent sessions only', async () => {
    const { ctx, create } = await mounted({ config: { policy: 'ask' } })
    const first = create()
    expect(ctx.escalation.overrideOf(first)).toBe('ask')

    await ctx.settings.update(ESCALATION_SETTINGS_NAMESPACE, { defaultPolicy: 'deny' })
    expect(ctx.escalation.defaultPolicy).toBe('deny')

    const second = create()
    expect(ctx.escalation.overrideOf(second)).toBe('deny')
    // The first session keeps its pinned policy: a setting change never rewrites
    // a session that already recorded one, so replay stays stable.
    expect(ctx.escalation.overrideOf(first)).toBe('ask')
  })

  it('rejects a stored default outside the closed policy vocabulary', async () => {
    const { ctx } = await mounted()
    await expect(ctx.settings.update(ESCALATION_SETTINGS_NAMESPACE, {
      defaultPolicy: 'sometimes',
    })).rejects.toThrow()
    expect(ctx.escalation.defaultPolicy).toBe('ask')
  })

  it('pins sessions that already exist when the service remounts', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const existing = ctx.sessions.create(SessionId('existing-before-escalation'))
    expect(existing.snapshotEvents()).toEqual([])

    await ctx.plugin(EscalationService, { policy: 'deny' })
    expect(ctx.escalation.overrideOf(existing)).toBe('deny')
  })

  it('leaves sessions that already recorded a policy untouched on remount', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const pinned = ctx.sessions.create(SessionId('pre-pinned'))
    pinned.append('escalation/policy', { policy: 'allow' })

    await ctx.plugin(EscalationService, { policy: 'ask' })
    expect(pinned.snapshotEvents().filter(event => event.type === 'escalation/policy')).toHaveLength(1)
    expect(ctx.escalation.overrideOf(pinned)).toBe('allow')
  })

  it('does not pin a session resumed from a seed', async () => {
    const { ctx, create } = await mounted({ config: { policy: 'deny' } })
    const source = Session.create(SessionId('resume-source'))
    source.append('turn/start', { turn: 1 })
    const resumed = ctx.sessions.create(SessionId('resumed-seed'), { seed: source.snapshotEvents() })

    expect(resumed.snapshotEvents().some(event => event.type === 'session/end-seed')).toBe(true)
    expect(ctx.escalation.overrideOf(resumed)).toBeUndefined()
    // No override: the effective policy falls back to the composition config.
    expect(ctx.escalation.current(resumed.snapshotEvents())).toBe('deny')
    expect(create().snapshotEvents().some(event => event.type === 'escalation/policy')).toBe(true)
  })
})
