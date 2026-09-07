import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { carrierKeyOf, createScope } from '@deepseek-ai/dsh-scope'
import type { Scope } from '@deepseek-ai/dsh-scope'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import EscalationService, {
  effectiveEscalationPolicy, escalationReason, setEscalationPolicy,
  type EscalationOutcome, type EscalationRequest,
} from '@deepseek-ai/dsh-escalation-policy'

/**
 * A minimal Agent stand-in — the service only reaches `agent.session.append`
 * and folds `.snapshotEvents()`. Seeded inside an open turn by default (request()'s
 * turn-enclosure precondition); pass `seed` to stage idle/closed logs.
 * Returns the recorded audit appends alongside the fake.
 */
function fakeAgent(seed: Array<{ type: string }> = [{ type: 'turn/start' }, { type: 'user/message' }]): { agent: Agent; appended: Array<{ type: string; data: Record<string, unknown> }> } {
  const appended: Array<{ type: string; data: Record<string, unknown> }> = []
  const agent = {
    session: {
      events: seed,
      append: (type: string, data: Record<string, unknown>) => {
        appended.push({ type, data })
        return { type, data } as unknown as SessionEvent
      },
    },
  } as unknown as Agent
  return { agent, appended }
}

async function mounted(config: ConstructorParameters<typeof EscalationService>[1] = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(EscalationService, config)
  return ctx
}

function requestOf(agent: Agent, overrides: Partial<EscalationRequest> = {}): EscalationRequest {
  return {
    agent,
    toolName: 'bash',
    target: 'workspace-write',
    justification: 'need wider write for this exact command',
    ...overrides,
  }
}

describe('EscalationService.request', () => {
  it('throws before appending anything when no turn has ever opened (idle ask)', async () => {
    const ctx = await mounted()
    const { agent, appended } = fakeAgent([])

    await expect(ctx.escalation.request(requestOf(agent))).rejects.toThrow(/outside an open turn/)
    expect(appended).toHaveLength(0)
  })

  it('throws between turns — a closed turn does not satisfy the enclosure precondition', async () => {
    const ctx = await mounted()
    const { agent, appended } = fakeAgent([{ type: 'turn/start' }, { type: 'turn/end' }])

    await expect(ctx.escalation.request(requestOf(agent))).rejects.toThrow(/outside an open turn/)
    expect(appended).toHaveLength(0)
  })

  it('fails closed to unavailable when nobody listens, auditing the asked/decided pair', async () => {
    const ctx = await mounted()
    const { agent, appended } = fakeAgent()

    const outcome = await ctx.escalation.request(requestOf(agent, { callId: ToolCallId('call-1') }))

    expect(outcome).toBe('unavailable')
    expect(appended.map(e => e.type)).toEqual(['escalation/asked', 'escalation/decided'])
    const [asked, decided] = appended
    expect(asked?.data).toMatchObject({
      toolName: 'bash',
      callId: 'call-1',
      target: 'workspace-write',
      reason: 'escalate sandbox to workspace-write: need wider write for this exact command',
    })
    expect(decided?.data).toMatchObject({ outcome: 'unavailable' })
    expect(decided?.data['id']).toBe(asked?.data['id'])
  })

  it('omits absent optional fields from the asked audit event', async () => {
    const ctx = await mounted()
    const { agent, appended } = fakeAgent()

    await ctx.escalation.request(requestOf(agent))

    expect(Object.keys(appended[0]?.data ?? {}).sort()).toEqual(['id', 'reason', 'target', 'toolName'])
  })

  it('borrows the exact readonly request for scoped dispatch and audit', async () => {
    const ctx = await mounted()
    const { agent, appended } = fakeAgent()
    let scope!: Scope
    const scopeFiber = await ctx.plugin(Object.assign((inner: Context) => {
      scope = createScope(inner, agent)
    }, { inject: ['escalation'] }))
    let received: EscalationRequest | undefined
    let carrier: unknown
    scope.ctx.on('escalation/request', function (req) {
      received = req
      carrier = carrierKeyOf(this)
      return Promise.resolve<EscalationOutcome>('allowed-once')
    })
    const request = requestOf(agent, {
      toolName: 'rm',
      callId: ToolCallId('scoped-call'),
      target: 'danger-full-access',
      justification: 'grant full access for this one delete',
    })

    await expect(ctx.escalation.request(request)).resolves.toBe('allowed-once')
    expect(carrier).toBe(agent)
    expect(received).toBe(request)
    expect(appended).toHaveLength(2)
    expect(appended[0]?.data).toMatchObject({
      toolName: 'rm',
      callId: 'scoped-call',
      target: 'danger-full-access',
      reason: 'escalate sandbox to danger-full-access: grant full access for this one delete',
    })
    expect(appended[1]?.data).toMatchObject({ outcome: 'allowed-once' })
    expect(appended[1]?.data['id']).toBe(appended[0]?.data['id'])
    await scopeFiber.dispose()
  })

  it('contains an escalation/asked observer throw after append and still completes the pair', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(EscalationService)
    const session = ctx.sessions.create(SessionId('asked-observer-throw'))
    session.append('turn/start', { turn: 1 })
    const agent = { session } as unknown as Agent
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    ctx.on('session/event', (_session, event) => {
      if (event.type === 'escalation/asked') throw new Error('observer failed after asked append')
    })
    ctx.on('escalation/request', () => Promise.resolve<EscalationOutcome>('allowed-once'))

    await expect(ctx.escalation.request(requestOf(agent))).resolves.toBe('allowed-once')

    // A fresh SessionStore session carries the pinned default `escalation/policy`;
    // the audit pair below is the asked/decided concern this test owns.
    const audit = session.snapshotEvents().filter(event =>
      event.type === 'escalation/asked' || event.type === 'escalation/decided')
    const asked = session.snapshotEvents().find((event): event is SessionEvent<'escalation/asked'> => event.type === 'escalation/asked')
    const decided = session.snapshotEvents().find((event): event is SessionEvent<'escalation/decided'> => event.type === 'escalation/decided')
    expect(audit.map(event => event.type)).toEqual(['escalation/asked', 'escalation/decided'])
    expect(decided?.data.id).toBe(asked?.data.id)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('session/event listener threw: Error: observer failed after asked append'))
  })

  it('contains an escalation/decided observer throw after append and still resolves', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(EscalationService)
    const session = ctx.sessions.create(SessionId('decided-observer-throw'))
    session.append('turn/start', { turn: 1 })
    const agent = { session } as unknown as Agent
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    ctx.on('session/event', (_session, event) => {
      if (event.type === 'escalation/decided') throw new Error('observer failed after decided append')
    })
    ctx.on('escalation/request', () => Promise.resolve<EscalationOutcome>('rejected'))

    await expect(ctx.escalation.request(requestOf(agent))).resolves.toBe('rejected')

    const audit = session.snapshotEvents().filter(event =>
      event.type === 'escalation/asked' || event.type === 'escalation/decided')
    const asked = session.snapshotEvents().find((event): event is SessionEvent<'escalation/asked'> => event.type === 'escalation/asked')
    const decided = session.snapshotEvents().find((event): event is SessionEvent<'escalation/decided'> => event.type === 'escalation/decided')
    expect(audit.map(event => event.type)).toEqual(['escalation/asked', 'escalation/decided'])
    expect(decided?.data).toMatchObject({ id: asked?.data.id, outcome: 'rejected' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('session/event listener threw: Error: observer failed after decided append'))
  })

  it('propagates an append failure that prevented audit log growth', async () => {
    const ctx = await mounted()
    const failure = new Error('append failed before log growth')
    const agent = {
      session: {
        events: [{ type: 'turn/start' }],
        append: () => { throw failure },
      },
    } as unknown as Agent

    await expect(ctx.escalation.request(requestOf(agent))).rejects.toBe(failure)
  })

  it('returns the first answering listener outcome (single decision slot)', async () => {
    const ctx = await mounted()
    const { agent } = fakeAgent()
    let secondRan = false
    ctx.on('escalation/request', () => Promise.resolve<EscalationOutcome>('allowed-once'))
    ctx.on('escalation/request', () => {
      secondRan = true
      return Promise.resolve<EscalationOutcome>('rejected')
    })

    await expect(ctx.escalation.request(requestOf(agent))).resolves.toBe('allowed-once')
    expect(secondRan).toBe(false)
  })

  it('lets a non-owning listener delegate via next() down to the fail-closed default', async () => {
    const ctx = await mounted()
    const { agent } = fakeAgent()
    ctx.on('escalation/request', (_req, next) => next())

    await expect(ctx.escalation.request(requestOf(agent))).resolves.toBe('unavailable')
  })

  it('keys the scoped dispatch carrier to the exact request agent', async () => {
    const ctx = await mounted()
    const { agent } = fakeAgent()
    let scope!: Scope
    const scopeFiber = await ctx.plugin(Object.assign((inner: Context) => {
      scope = createScope(inner, agent)
    }, { inject: ['escalation'] }))
    let seenKey: object | undefined
    scope.ctx.on('escalation/request', function (req, next) {
      seenKey = carrierKeyOf(this)
      expect(req.agent).toBe(agent)
      return next()
    })

    await expect(ctx.escalation.request(requestOf(agent))).resolves.toBe('unavailable')

    expect(seenKey).toBe(agent)
    await scopeFiber.dispose()
  })

  it('contains a throwing answerer as unavailable', async () => {
    const ctx = await mounted()
    const { agent, appended } = fakeAgent()
    ctx.on('escalation/request', () => Promise.reject(new Error('transport died')))

    await expect(ctx.escalation.request(requestOf(agent))).resolves.toBe('unavailable')
    expect(appended[1]?.data).toMatchObject({ outcome: 'unavailable' })
  })

  it('normalizes a rogue non-vocabulary answer to unavailable', async () => {
    const ctx = await mounted()
    const { agent } = fakeAgent()
    // A JS answerer can return anything; the seam must not leak it into
    // callers' closed-union switches.
    ctx.on('escalation/request', () => Promise.resolve('yolo' as EscalationOutcome))

    await expect(ctx.escalation.request(requestOf(agent))).resolves.toBe('unavailable')
  })

  it('settles cancelled immediately on an already-aborted signal without asking anyone', async () => {
    const ctx = await mounted()
    const { agent, appended } = fakeAgent()
    let asked = false
    ctx.on('escalation/request', () => {
      asked = true
      return Promise.resolve<EscalationOutcome>('allowed-once')
    })

    const outcome = await ctx.escalation.request(requestOf(agent, { signal: AbortSignal.abort() }))

    expect(outcome).toBe('cancelled')
    expect(asked).toBe(false)
    expect(appended.map(e => e.type)).toEqual(['escalation/asked', 'escalation/decided'])
    expect(appended[1]?.data).toMatchObject({ outcome: 'cancelled' })
  })

  it('resolves cancelled when the signal aborts mid-question and discards the late answer', async () => {
    const ctx = await mounted()
    const { agent, appended } = fakeAgent()
    let settleLate: ((outcome: EscalationOutcome) => void) | undefined
    ctx.on('escalation/request', () => new Promise<EscalationOutcome>((resolve) => { settleLate = resolve }))
    const controller = new AbortController()

    const pending = ctx.escalation.request(requestOf(agent, { signal: controller.signal }))
    controller.abort()
    await expect(pending).resolves.toBe('cancelled')

    // The answerer settles after the fact: no second decided event appears.
    settleLate?.('allowed-once')
    await Promise.resolve()
    expect(appended.filter(e => e.type === 'escalation/decided')).toHaveLength(1)
    expect(appended[1]?.data).toMatchObject({ outcome: 'cancelled' })
  })

  it('discards a late REJECTION after abort without an unhandled rejection', async () => {
    const ctx = await mounted()
    const { agent } = fakeAgent()
    let rejectLate: ((error: Error) => void) | undefined
    ctx.on('escalation/request', () => new Promise<EscalationOutcome>((_resolve, reject) => { rejectLate = reject }))
    const controller = new AbortController()

    const pending = ctx.escalation.request(requestOf(agent, { signal: controller.signal }))
    controller.abort()
    await expect(pending).resolves.toBe('cancelled')

    rejectLate?.(new Error('answered too late'))
    // Drain microtasks: the contained rejection must not escape the seam.
    await new Promise((resolve) => { setTimeout(resolve, 0) })
  })

  it('resolves the answer when the signal never aborts', async () => {
    const ctx = await mounted()
    const { agent } = fakeAgent()
    ctx.on('escalation/request', () => Promise.resolve<EscalationOutcome>('rejected'))
    const controller = new AbortController()

    await expect(ctx.escalation.request(requestOf(agent, { signal: controller.signal }))).resolves.toBe('rejected')
  })

  it('issues a fresh id per request', async () => {
    const ctx = await mounted()
    const { agent, appended } = fakeAgent()

    await ctx.escalation.request(requestOf(agent))
    await ctx.escalation.request(requestOf(agent))

    const ids = appended.filter(e => e.type === 'escalation/asked').map(e => e.data['id'])
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })

  it('drops a disposed plugin listener from the chain (HMR safety)', async () => {
    const ctx = await mounted()
    const { agent } = fakeAgent()
    const fiber = await ctx.plugin((inner: Context) => {
      inner.on('escalation/request', () => Promise.resolve<EscalationOutcome>('allowed-once'))
    })
    await expect(ctx.escalation.request(requestOf(agent))).resolves.toBe('allowed-once')

    await fiber.dispose()
    await expect(ctx.escalation.request(requestOf(agent))).resolves.toBe('unavailable')
  })
})

describe('escalation policy (the escalation/policy fold)', () => {
  const ASK_SENTENCE = 'Escalation policy: ask. Sandbox escalation retries (sandbox_permissions with a justification) may ask through the configured answerers; without an available answerer the retry fails closed.'
  const DENY_SENTENCE = 'Escalation policy: deny. Sandbox escalation retries (sandbox_permissions with a justification) are auto-denied in this session — do not request sandbox escalation (do not set sandbox_permissions).'
  const ALLOW_SENTENCE = 'Escalation policy: allow. A strictly-wider sandbox escalation retry (sandbox_permissions with a justification) is granted automatically in this session without asking the user.'

  /**
   * An agent stand-in over a REAL Session — gate and context fold real events;
   * the opened turn satisfies request()'s enclosure precondition.
   */
  function sessionAgent(id: string): { agent: Agent; session: Session } {
    const session = Session.create(SessionId(id))
    session.append('turn/start', { turn: 1 })
    const agent = { id, session } as unknown as Agent
    return { agent, session }
  }

  it('folds to the last event, or undefined without one', () => {
    const { session } = sessionAgent('sess-fold')
    expect(effectiveEscalationPolicy(session.snapshotEvents())).toBeUndefined()
    setEscalationPolicy(session, 'deny')
    setEscalationPolicy(session, 'ask')
    expect(effectiveEscalationPolicy(session.snapshotEvents())).toBe('ask')
    expect(session.snapshotEvents().at(-1)).toMatchObject({ type: 'escalation/policy', data: { policy: 'ask' } })
  })

  it('rejects a policy outside the closed vocabulary before appending', () => {
    const append = vi.fn()
    const session = { append } as unknown as Session
    expect(() => { setEscalationPolicy(session, 'sometimes' as Parameters<typeof setEscalationPolicy>[1]) })
      .toThrow('escalation policy must be one of "ask", "deny", or "allow"')
    expect(append).not.toHaveBeenCalled()
  })

  it('builds the audit reason from target and justification', () => {
    expect(escalationReason('danger-full-access', 'clean up the whole tree')).toBe(
      'escalate sandbox to danger-full-access: clean up the whole tree')
  })

  it('defaults a schema-less construction to ask (the ?? narrows the optional TYPE)', async () => {
    // Direct construction bypasses the plugin schema (the SystemPrompt-test
    // precedent for covering a defaulted Config field's type-narrowing ??).
    const ctx = new Context()
    const service = new EscalationService(ctx, {})
    const { agent } = sessionAgent('sess-bare-config')
    ctx.on('escalation/request', () => Promise.resolve<EscalationOutcome>('allowed-once'))
    await expect(service.request(requestOf(agent))).resolves.toBe('allowed-once')
  })

  it('contains an answerer that throws SYNCHRONOUSLY as unavailable', async () => {
    const ctx = new Context()
    await ctx.plugin(EscalationService)
    const { agent } = sessionAgent('sess-syncthrow')
    ctx.on('escalation/request', () => { throw new Error('sync bug') })
    await expect(ctx.escalation.request(requestOf(agent))).resolves.toBe('unavailable')
  })

  it('a deny config rejects deterministically without consulting any answerer', async () => {
    const ctx = new Context()
    await ctx.plugin(EscalationService, { policy: 'deny' })
    const consulted = vi.fn()
    ctx.on('escalation/request', (_req, next) => { consulted(); return next() })
    const { agent, session } = sessionAgent('sess-gate-1')
    await expect(ctx.escalation.request(requestOf(agent))).resolves.toBe('rejected')
    expect(consulted).not.toHaveBeenCalled()
    // The audit pair still lands on the session log.
    expect(session.snapshotEvents().filter(e => e.type === 'escalation/asked')).toHaveLength(1)
    expect(session.snapshotEvents().filter(e => e.type === 'escalation/decided')).toHaveLength(1)
  })

  it('an allow config grants deterministically without consulting any answerer', async () => {
    const ctx = new Context()
    await ctx.plugin(EscalationService, { policy: 'allow' })
    const consulted = vi.fn()
    ctx.on('escalation/request', (_req, next) => { consulted(); return next() })
    const { agent, session } = sessionAgent('sess-allow-gate')
    await expect(ctx.escalation.request(requestOf(agent))).resolves.toBe('allowed-once')
    expect(consulted).not.toHaveBeenCalled()
    expect(session.snapshotEvents().filter(e => e.type === 'escalation/asked')).toHaveLength(1)
    expect(session.snapshotEvents().filter(e => e.type === 'escalation/decided')).toHaveLength(1)
  })

  it('the gate decides FIRST even against an answerer registered before the service (prepend)', async () => {
    const ctx = new Context()
    ctx.on('escalation/request', () => Promise.resolve<EscalationOutcome>('allowed-once'))
    await ctx.plugin(EscalationService, { policy: 'deny' })
    const { agent } = sessionAgent('sess-gate-2')
    await expect(ctx.escalation.request(requestOf(agent))).resolves.toBe('rejected')
  })

  it('deny is unbypassable even by an answerer PREPENDED after the service mounts', async () => {
    // Cordis prepend unshifts ahead of every existing listener, including any gate LISTENER the
    // service could register — which is exactly why the 'deny' decision lives inside request()
    // instead. This eager grant would bypass a listener-based gate and therefore must never run.
    const ctx = new Context()
    await ctx.plugin(EscalationService, { policy: 'deny' })
    const consulted = vi.fn()
    ctx.on('escalation/request', () => { consulted(); return Promise.resolve<EscalationOutcome>('allowed-once') }, { prepend: true })
    const { agent, appended } = fakeAgent()
    await expect(ctx.escalation.request(requestOf(agent))).resolves.toBe('rejected')
    expect(consulted).not.toHaveBeenCalled()
    expect(appended.map(e => e.type)).toEqual(['escalation/asked', 'escalation/decided'])
  })

  it('allow is unbypassable even by an answerer PREPENDED after the service mounts', async () => {
    const ctx = new Context()
    await ctx.plugin(EscalationService, { policy: 'allow' })
    const consulted = vi.fn()
    ctx.on('escalation/request', () => { consulted(); return Promise.resolve<EscalationOutcome>('rejected') }, { prepend: true })
    const { agent, appended } = fakeAgent()
    await expect(ctx.escalation.request(requestOf(agent))).resolves.toBe('allowed-once')
    expect(consulted).not.toHaveBeenCalled()
    expect(appended.map(e => e.type)).toEqual(['escalation/asked', 'escalation/decided'])
  })

  it('a session override outranks the configured default, in both directions', async () => {
    const ctx = new Context()
    await ctx.plugin(EscalationService, { policy: 'deny' })
    ctx.on('escalation/request', () => Promise.resolve<EscalationOutcome>('allowed-once'))
    const { agent, session } = sessionAgent('sess-gate-3')
    expect(ctx.escalation.overrideOf(session)).toBeUndefined()
    setEscalationPolicy(session, 'ask')
    expect(ctx.escalation.overrideOf(session)).toBe('ask')
    await expect(ctx.escalation.request(requestOf(agent))).resolves.toBe('allowed-once')
    setEscalationPolicy(session, 'deny')
    await expect(ctx.escalation.request(requestOf(agent))).resolves.toBe('rejected')
    setEscalationPolicy(session, 'allow')
    await expect(ctx.escalation.request(requestOf(agent))).resolves.toBe('allowed-once')
  })

  it('queues a live policy switch for the next model step', async () => {
    const ctx = new Context()
    await ctx.plugin(EscalationService)
    const { agent, session } = sessionAgent('sess-policy-notice')
    const inject = vi.fn<Agent['inject']>()
    const liveAgent = { ...agent, inject } as Agent

    ctx.escalation.setPolicy(liveAgent, 'deny')
    ctx.escalation.setPolicy(liveAgent, 'deny')

    expect(effectiveEscalationPolicy(session.snapshotEvents())).toBe('deny')
    expect(inject).toHaveBeenCalledOnce()
    expect(inject.mock.calls[0]?.[0]).toMatchObject({
      content: [{
        type: 'text',
        text: 'The escalation policy changed from "ask" to "deny" (changed by the user).',
      }],
      source: { kind: 'plugin', plugin: 'escalation-policy' },
    })
  })

  it('contributes the complete current ask, deny, or allow policy as cache-safe context', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(EscalationService)
    const askAgent = sessionAgent('sess-sect-ask').agent
    const { agent: denyAgent, session } = sessionAgent('sess-sect-deny')
    setEscalationPolicy(session, 'deny')
    const { agent: allowAgent, session: allowSession } = sessionAgent('sess-sect-allow')
    setEscalationPolicy(allowSession, 'allow')
    const contextFor = async (context: object) =>
      (await ctx.systemPrompt.assemble(context)).contexts.find(entry => entry.name === 'escalation:policy')?.text
    expect(await contextFor({ agent: askAgent })).toBe(ASK_SENTENCE)
    expect(await contextFor({ agent: denyAgent })).toBe(DENY_SENTENCE)
    expect(await contextFor({ agent: allowAgent })).toBe(ALLOW_SENTENCE)
    // A bare assemble (no agent) has no session to state.
    expect(await contextFor({})).toBe('')
  })

  it('reflects the latest durable switch in cache-safe context and stays byte-stable while unchanged', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(EscalationService)
    const { agent, session } = sessionAgent('sess-context-switch')
    const contextFor = async () =>
      (await ctx.systemPrompt.assemble({ agent })).contexts.find(entry => entry.name === 'escalation:policy')?.text
    expect(await contextFor()).toBe(ASK_SENTENCE)
    expect(await contextFor()).toBe(ASK_SENTENCE)
    setEscalationPolicy(session, 'deny')
    setEscalationPolicy(session, 'ask')
    setEscalationPolicy(session, 'allow')
    expect(await contextFor()).toBe(ALLOW_SENTENCE)
    expect(await contextFor()).toBe(ALLOW_SENTENCE)
  })

  it('disposes the runtime-context contribution with the service', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const fiber = await ctx.plugin(EscalationService)
    const { agent } = sessionAgent('sess-hmr-service-live')
    const contextFor = async () =>
      (await ctx.systemPrompt.assemble({ agent })).contexts.find(context => context.name === 'escalation:policy')
    expect(await contextFor()).toBeDefined()
    await fiber.dispose()
    expect(await contextFor()).toBeUndefined()
  })
})
