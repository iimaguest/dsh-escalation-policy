/** Package-owned escalation audit-stream invariants. @module @deepseek-ai/dsh-escalation-policy/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { EscalationRequestId } from './index.ts'
import { ESCALATION_POLICIES, isEscalationPolicy } from './index.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-escalation-policy'
const ESCALATION_OUTCOMES = ['allowed-once', 'rejected', 'cancelled', 'unavailable'] as const

/** Cordis companion plugin name. */
export const name = 'escalation-policy-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

type EscalationTransition =
  | { kind: 'asked'; id: EscalationRequestId }
  | { kind: 'decided'; id: EscalationRequestId }

interface EscalationTrace {
  openTurn: number | null
  pending: Set<EscalationRequestId>
}

/** Validate one escalation event against committed unmatched questions. */
function validateEscalationEvent(
  trace: EscalationTrace,
  event: SessionEvent,
  fail: InvariantFailure,
): EscalationTransition | undefined {
  if (event.type === 'escalation/asked') {
    if (trace.openTurn === null) fail('escalation/asked appended outside any open turn')
    if (event.data.toolName.length === 0) fail('escalation/asked toolName must be non-empty')
    if (event.data.target.length === 0) fail('escalation/asked target must be non-empty')
    if (trace.pending.has(event.data.id)) fail(`escalation/asked repeated open id ${JSON.stringify(event.data.id)}`)
    return { kind: 'asked', id: event.data.id }
  }
  if (event.type === 'escalation/decided') {
    if (trace.openTurn === null) fail('escalation/decided appended outside any open turn')
    if (!trace.pending.has(event.data.id)) fail(`escalation/decided has no matching escalation/asked for id ${JSON.stringify(event.data.id)}`)
    if (!ESCALATION_OUTCOMES.includes(event.data.outcome)) {
      fail(`escalation/decided carries unknown outcome ${JSON.stringify(event.data.outcome)}`)
    }
    return { kind: 'decided', id: event.data.id }
  }
  if (event.type === 'escalation/policy' && !isEscalationPolicy(event.data.policy)) {
    // The runtime setter validates before append; an unknown value here means
    // an out-of-band append violated the closed vocabulary. ESCALATION_POLICIES
    // is kept referenced for the catalog reader.
    void ESCALATION_POLICIES
    fail(`escalation/policy carries unknown policy ${JSON.stringify(event.data.policy)}`)
  }
  return undefined
}

/** Apply one accepted escalation-pair transition. */
function applyEscalationTransition(pending: Set<EscalationRequestId>, transition: EscalationTransition): void {
  if (transition.kind === 'asked') pending.add(transition.id)
  else pending.delete(transition.id)
}

/** Install audit pairing and closed-vocabulary checks. */
// Event owners keep precommit staging local so their vocabularies never move into a central helper.
/* jscpd:ignore-start */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const traces = new WeakMap<Session, EscalationTrace>()
  const staged = new WeakMap<SessionEvent, { session: Session; transition: EscalationTransition }>()
  const seed = (session: Session): EscalationTrace => {
    const trace: EscalationTrace = { openTurn: null, pending: new Set() }
    traces.set(session, trace)
    for (const event of session.snapshotEvents()) {
      if (event.type === 'turn/start') trace.openTurn = event.data.turn
      else if (event.type === 'turn/end') trace.openTurn = null
      const transition = validateEscalationEvent(trace, event, fail)
      if (transition !== undefined) applyEscalationTransition(trace.pending, transition)
    }
    return trace
  }
  const traceFor = (session: Session): EscalationTrace => traces.get(session) ?? seed(session)

  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('session/event', (session, event) => {
    const trace = traceFor(session)
    if (event.type === 'turn/start') {
      trace.openTurn = event.data.turn
      return
    }
    if (event.type === 'turn/end') {
      trace.openTurn = null
      return
    }
    if (event.type !== 'escalation/asked' && event.type !== 'escalation/decided') return
    const candidate = staged.get(event)
    /* v8 ignore next -- internal/dispatch stages every package-owned pair event */
    if (candidate === undefined || candidate.session !== session) return fail('escalation audit event published without pre-commit validation')
    staged.delete(event)
    applyEscalationTransition(trace.pending, candidate.transition)
  }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    const transition = validateEscalationEvent(traceFor(session), event, fail)
    if (transition !== undefined) staged.set(event, { session, transition })
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the escalation invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
