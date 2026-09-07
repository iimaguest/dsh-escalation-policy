import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { EscalationRequestId } from '@deepseek-ai/dsh-escalation-policy'
import * as EscalationInvariant from '@deepseek-ai/dsh-escalation-policy/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(EscalationInvariant)
  return ctx
}

function startTurn(session: Session): void {
  session.append('turn/start', { turn: 1 })
}

describe('escalation invariants', () => {
  it('accepts paired audit events and closed policy values', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    startTurn(session)
    const id = EscalationRequestId('ask-1')
    session.append('escalation/asked', { id, toolName: 'bash', target: 'workspace-write' })
    session.append('escalation/decided', { id, outcome: 'allowed-once' })
    session.append('escalation/policy', { policy: 'deny' })
  })

  it('rebuilds an unmatched question from an existing session', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    const id = EscalationRequestId('ask-resume')
    session.append('escalation/asked', { id, toolName: 'bash', target: 'workspace-write' })
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(EscalationInvariant)
    expect(() => session.append('escalation/decided', { id, outcome: 'cancelled' })).not.toThrow()
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  })

  it('adopts a bare session first observed through publication', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('bare-escalation-session'))
    const id = EscalationRequestId('bare-ask')
    const asked = {
      type: 'escalation/asked', seq: SessionSeq(0), time: 0, data: { id, toolName: 'bash', target: 'workspace-write' },
    } as const
    const decided = {
      type: 'escalation/decided', seq: SessionSeq(1), time: 1, data: { id, outcome: 'rejected' as const },
    } as const
    expect(() => {
      ctx.emit('session/event', session, {
        type: 'turn/start', seq: SessionSeq(0), time: 0,
        data: { turn: 1 },
      })
      ctx.emit('session/event', session, asked)
      ctx.emit('session/event', session, decided)
    }).not.toThrow()
  })

  it('rejects audit events outside any open turn', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    expect(() => session.append('escalation/asked', {
      id: EscalationRequestId('ask-1'), toolName: 'bash', target: 'workspace-write',
    })).toThrow(/outside any open turn/)
    expect(() => session.append('escalation/decided', {
      id: EscalationRequestId('ask-1'), outcome: 'rejected',
    })).toThrow(/outside any open turn/)
  })

  it('rejects an unenclosed audit event when replaying an existing session', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create()
    startTurn(session)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('escalation/asked', {
      id: EscalationRequestId('ask-replay'), toolName: 'bash', target: 'workspace-write',
    })
    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(EscalationInvariant).then(() => undefined)).rejects.toThrow(/outside any open turn/)
  })

  it('rejects malformed and unpaired audit events', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    startTurn(session)
    const id = EscalationRequestId('ask-1')
    expect(() => session.append('escalation/asked', { id, toolName: '', target: 'workspace-write' }))
      .toThrow(/toolName must be non-empty/)
    expect(() => session.append('escalation/asked', { id, toolName: 'bash', target: '' }))
      .toThrow(/target must be non-empty/)
    session.append('escalation/asked', { id, toolName: 'bash', target: 'workspace-write' })
    expect(() => session.append('escalation/asked', { id, toolName: 'bash', target: 'workspace-write' }))
      .toThrow(/repeated open id/)
    expect(() => session.append('escalation/decided', {
      id: EscalationRequestId('missing'), outcome: 'rejected',
    })).toThrow(/no matching escalation\/asked/)
    expect(() => session.append('escalation/decided', { id, outcome: 'maybe' as never }))
      .toThrow(/unknown outcome/)
    expect(() => session.append('escalation/policy', { policy: 'always' as never }))
      .toThrow(/unknown policy/)
  })
})
