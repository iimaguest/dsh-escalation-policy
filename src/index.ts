/**
 * Service Definition for the escalation capability seam: sandbox-escalation
 * permission decisions routed through a dedicated `escalation/request`
 * waterfall — structurally separate from generic `approval/request` — with
 * per-session escalation policy (`escalation/policy`), a self-contained audit
 * pair (`escalation/asked` + `escalation/decided`), and composed answerers.
 * The tool layer asks through {@link EscalationService.request}; the model
 * learns the policy from the runtime-context snapshot and live switch
 * notices; a UI reads the `escalation` session projection and writes through
 * the `/escalation` command. Missing answerers fail closed; grants apply only
 * to the one requested mode.
 *
 * The seam owns the policy while the shared sandbox vocabulary
 * (`@deepseek-ai/dsh-sandbox`'s `approveEscalation`) keeps the strictly-wider
 * judgment and outcome mapping in the enforcing tool family — this package
 * never imports the sandbox package.
 *
 * @module @deepseek-ai/dsh-escalation-policy
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ToolCallId } from '@deepseek-ai/dsh-llm'
import { scopeTarget, type Scoped } from '@deepseek-ai/dsh-scope'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
// Side-effect type imports: declaration-merges the service-required
// `sessionProjections` and `commands` ctx faces without value dependencies.
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-commands'
// Side-effect type import: provides the `systemPrompt` service surface.
import type {} from '@deepseek-ai/dsh-system-prompt'
// The settings section + namespace the new-session default rides (installed
// only when a settings provider is composed).
import type { SettingsSectionHooks } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { EscalationOption, EscalationOutcome, EscalationPolicy, EscalationSelect } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    escalation: EscalationService
  }

  interface Events {
    /**
     * Ask composed answerers for one escalation decision. Return an outcome
     * to claim the request or call `next()`; failure yields the fail-closed
     * default. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`):
     * agent-scoped listeners receive only that agent.
     * @param req - the pending escalation decision (agent, tool identity, target mode, justification, signal).
     * @mode waterfall
     */
    'escalation/request'(this: Scoped<EscalationService>, req: EscalationRequest, next: () => Promise<EscalationOutcome>): Promise<EscalationOutcome>
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * An escalation question was put to the answerer chain — log-only audit
     * (like `approval/asked`; NOT a surface event, carries no `surfaceOp`).
     * `id` pairs it with the `escalation/decided` that always follows;
     * `toolName` is the tool the retry is about, `callId` the exact tool call
     * when the asker had one, `target` the requested sandbox mode, `reason`
     * the asker's human-readable explanation.
     */
    'escalation/asked': {
      id: EscalationRequestId
      toolName: string
      callId?: ToolCallId
      /** The requested sandbox mode (already validated strictly wider by the asking tool). */
      target: string
      reason?: string
    }
    /**
     * The outcome of a prior `escalation/asked` (same `id`) — log-only audit.
     * Exactly one per ask, appended when the outcome is known: a decision, a
     * cancellation, or the fail-closed `'unavailable'`.
     */
    'escalation/decided': {
      id: EscalationRequestId
      outcome: EscalationOutcome
    }
    /**
     * The session's escalation policy was switched — log-only, durable,
     * replayable, never in the model transcript (the model learns the policy
     * from the runtime-context snapshot and live switch notices). The LAST
     * such event is the session's override ({@link effectiveEscalationPolicy}).
     * `source: 'delegation'` marks an override seeded into a child; an absent
     * source is a runtime switch.
     */
    'escalation/policy': {
      policy: EscalationPolicy
      /** Marks an override seeded into a child at delegation. */
      source?: 'delegation'
    }
  }
}

import { EscalationRequestId } from './types.ts'
export { EscalationRequestId } from './types.ts'
export type { EscalationOption, EscalationOutcome, EscalationPolicy, EscalationSelect } from './types.ts'
export type * from './types.ts'

/** Every {@link EscalationOutcome}, for runtime normalization of answerer returns. */
const OUTCOMES: readonly EscalationOutcome[] = ['allowed-once', 'rejected', 'cancelled', 'unavailable']

/** Every {@link EscalationPolicy}, in advertisement order (option order and validation vocabulary). */
export const ESCALATION_POLICIES: readonly EscalationPolicy[] = ['ask', 'deny', 'allow']

/** Settings namespace carrying the default escalation policy for future sessions. */
export const ESCALATION_SETTINGS_NAMESPACE = 'escalation' as SettingsNamespace

/** Presentation bundle for one escalation-policy option (the projection's display face). */
const POLICY_PRESENTATION: Record<EscalationPolicy, { name: string; description?: string }> = {
  ask: { name: 'Ask escalation', description: 'A wider access retry may ask you for approval.' },
  deny: { name: 'Auto deny', description: 'A wider access retry is rejected automatically without asking.' },
  allow: { name: 'Always allow', description: 'A wider access retry is granted automatically without asking.' },
}

/**
 * Runtime validation of untrusted escalation-policy strings.
 * @param value - the raw policy value.
 * @returns whether the value is one of the closed policy vocabulary.
 */
export function isEscalationPolicy(value: string): value is EscalationPolicy {
  return (ESCALATION_POLICIES as readonly string[]).includes(value)
}

/** Model-facing statement for the deterministic `'deny'` policy. */
const DENY_SENTENCE = 'Escalation policy: deny. Sandbox escalation retries (sandbox_permissions with a justification) are auto-denied in this session — do not request sandbox escalation (do not set sandbox_permissions).'
/** Model-facing statement for the auto-allowing `'allow'` policy. */
const ALLOW_SENTENCE = 'Escalation policy: allow. A strictly-wider sandbox escalation retry (sandbox_permissions with a justification) is granted automatically in this session without asking the user.'
/** Model-facing statement for an interactive policy that may still fail closed. */
const ASK_SENTENCE = 'Escalation policy: ask. Sandbox escalation retries (sandbox_permissions with a justification) may ask through the configured answerers; without an available answerer the retry fails closed.'

/**
 * The session's escalation-policy override: the last `escalation/policy`
 * event in the log, or undefined when the session never switched (callers
 * apply the service's configured default). The pure fold — resume needs no
 * catch-up machinery because replaying the log IS the state.
 * @param events - session events in log order (other event types are skipped).
 * @returns the policy of the last switch event, or undefined without one.
 */
export function effectiveEscalationPolicy(events: readonly SessionEvent[]): EscalationPolicy | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as SessionEvent
    if (event.type === 'escalation/policy') return event.data.policy
  }
  return undefined
}

/**
 * Whether the log currently sits inside an open turn (a `turn/start` not yet
 * closed by a `turn/end`) — the {@link EscalationService.request} precondition.
 * The audit pair must be turn-enclosed: the turn is the durable log's
 * commit/replay boundary, so a bare event appended between turns is
 * indistinguishable from a crash tail and silently dropped on reload.
 */
function hasOpenTurn(events: readonly SessionEvent[]): boolean {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const type = (events[index] as SessionEvent).type
    if (type === 'turn/start') return true
    if (type === 'turn/end') return false
  }
  return false
}

/**
 * Append the sole durable representation of a session escalation-policy
 * override. Invalid values throw before the log changes; consumers fold the
 * new value on each read.
 * @param session - the session the override belongs to.
 * @param policy - the policy in effect until the next switch.
 */
export function setEscalationPolicy(session: Session, policy: EscalationPolicy): void {
  if (!isEscalationPolicy(policy)) {
    throw new TypeError('escalation policy must be one of "ask", "deny", or "allow"')
  }
  session.append('escalation/policy', { policy })
}

/**
 * The audit/headline reason for one escalation ask — the single human-readable
 * sentence both the audit trail and the GUI presentation use.
 * @param target - the requested sandbox mode.
 * @param justification - the model's one-sentence reason.
 * @returns the full reason sentence.
 */
export function escalationReason(target: string, justification: string): string {
  return `escalate sandbox to ${target}: ${justification}`
}

/**
 * Readonly same-process escalation question. `callId` links to an already
 * presented tool call, so arguments are not duplicated here.
 */
export interface EscalationRequest {
  /**
   * The agent on whose behalf the question is asked. Routes the question (a
   * UI answerer only answers for agents it owns) and receives the audit
   * events on its session log.
   */
  readonly agent: Agent
  /** The tool the retry is about (presentation and audit). */
  readonly toolName: string
  /**
   * The exact tool call being decided, when the asker has one — lets a UI
   * attach the prompt to the tool call it already streamed.
   */
  readonly callId?: ToolCallId
  /** The requested sandbox mode (strictly wider than the call's effective mode — validated by the asking tool). */
  readonly target: string
  /** The model's one-sentence reason, shown verbatim to the user (and stored in the audit reason). */
  readonly justification: string
  /**
   * Aborting withdraws the question: the request settles `'cancelled'`
   * immediately and a late answer from a still-pending answerer is discarded.
   */
  readonly signal?: AbortSignal
}

/** Plugin config. All optional — `static Config` supplies the defaults. */
export interface Config {
  /**
   * The deployment's default {@link EscalationPolicy} for sessions without an
   * `escalation/policy` override — `'ask'` delegates to the composed
   * answerers (fail-closed with none); `'deny'` auto-rejects every escalation
   * ask without prompting; `'allow'` auto-grants every strictly-wider ask
   * without prompting.
   */
  readonly policy?: EscalationPolicy
}

/** User setting resolved when a new session receives its initial escalation policy. */
export interface EscalationSettings {
  /** Policy pinned into a newly created session. */
  defaultPolicy: EscalationPolicy
}

/**
 * Escalation service that applies session policy before answerers and logs
 * every ask/outcome pair to the requesting session. It exposes deterministic
 * policy changes to the model through the runtime-context snapshot and switch
 * notices, and publishes the `escalation` session projection plus the
 * `/escalation` command when their registries are composed.
 */
export class EscalationService extends Service {
  static Config: z<Config> = z.object({
    policy: z.union(['ask', 'deny', 'allow'] as const).default('ask'),
  })

  /** The settings source resolving the policy pinned into new sessions. */
  private defaultSettings: () => EscalationSettings

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'escalation')

    // The new-session default: a user-editable settings namespace that pins a
    // durable `escalation/policy` into each genuinely fresh session (so replay
    // reconstructs the policy the user picked, independent of later setting
    // changes). Without a settings provider the composition config is the
    // default. The read side — this service's own settings source — updates in
    // place via `setSource`; nothing re-registers on change.
    const baseSettings: EscalationSettings = { defaultPolicy: config.policy ?? 'ask' }
    this.defaultSettings = () => baseSettings
    const policyChoices = ESCALATION_POLICIES.map((policy) => {
      const choice = z.const(policy)
      const label = POLICY_PRESENTATION[policy].name
      return label === undefined ? choice : choice.description(label)
    })
    const settingsSchema: z<EscalationSettings> = z.object({
      defaultPolicy: z.union(policyChoices).required(),
    })
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(ctx, ESCALATION_SETTINGS_NAMESPACE, settingsSchema, baseSettings, {
        setSource: (current) => {
          this.defaultSettings = current
        },
        onChange: () => {},
      } satisfies SettingsSectionHooks<EscalationSettings>)
    })

    ctx.on('session/created', (session) => {
      this.pinInitialPolicy(session)
    })
    const sessions = ctx.get('sessions')
    for (const session of sessions === undefined ? [] : sessions.list()) {
      this.pinInitialPolicy(session)
    }

    const effective = (agent: Agent): EscalationPolicy => this.effectivePolicy(agent.session)

    // The complete current value travels after retained history, so switching
    // policy does not rewrite the stable system-prompt cache prefix.
    ctx.inject(['systemPrompt'], (scope: Context) => {
      scope.systemPrompt.context({
        name: 'escalation:policy',
        order: 116,
        text: (context) => {
          const agent = context.agent
          // A bare assemble() (tests, diagnostics) has no session to state.
          if (agent === undefined) return ''
          const policy = effective(agent)
          return policy === 'deny'
            ? DENY_SENTENCE
            : policy === 'allow' ? ALLOW_SENTENCE : ASK_SENTENCE
        },
      })
    })

    // The escalation projection unit: fold the durable whole-value policy
    // override; the view derives the select over the composition default this
    // service already owns. The unit child activates only when a projection
    // registry is composed (headless assemblies stay unaffected).
    const selectSchema = zod.object({
      options: zod.array(zod.object({
        value: zod.union([zod.literal('ask'), zod.literal('deny'), zod.literal('allow')]),
        name: zod.string().min(1),
        description: zod.string().optional(),
      })),
      currentValue: zod.union([zod.literal('ask'), zod.literal('deny'), zod.literal('allow')]),
    }) as unknown as zod.ZodType<EscalationSelect>
    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register<'escalation', EscalationPolicy | null>({
        key: 'escalation',
        stateSchema: zod.union([
          zod.literal('ask'),
          zod.literal('deny'),
          zod.literal('allow'),
        ]).nullable(),
        init: () => null,
        apply: (state, event) => {
          switch (event.type) {
            case 'escalation/policy':
              return event.data.policy
            default:
              return state
          }
        },
        wire: { viewSchema: selectSchema, view: state => this.selectFor(state) },
        stateVersion: 1,
      })
    })

    // The /escalation command: the one write path a web client uses (the
    // composer icon submits the picked policy as this line). The child
    // activates only when a command registry is composed.
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register({
        name: 'escalation',
        description: 'Switch the per-session sandbox-escalation policy (ask, deny, or allow)',
        input: { hint: '<ask|deny|allow>' },
        // No settlement text labels its value with this command's own name: a
        // surface that renders `name · text` (the web command row) would
        // otherwise read `escalation · Escalation policy ask.`.
        handler: ({ agent, rawInput }) => {
          const name = rawInput.trim()
          if (name === '') {
            return { kind: 'success', text: `current escalation policy ${this.current(agent.session.snapshotEvents())} (available: ${ESCALATION_POLICIES.join(', ')})` }
          }
          if (!isEscalationPolicy(name)) {
            return { kind: 'error', text: `unknown escalation policy "${name}" (available: ${ESCALATION_POLICIES.join(', ')})` }
          }
          this.setPolicy(agent, name)
          return { kind: 'success', text: `escalation policy ${name}` }
        },
      })
    })
  }

  /**
   * The current default escalation policy for subsequently created sessions:
   * the user settings value, else the composition config default.
   * @returns the policy the next genuinely fresh session is pinned with.
   */
  get defaultPolicy(): EscalationPolicy {
    return this.defaultSettings().defaultPolicy
  }

  /**
   * Switch one live agent's escalation policy and queue the transition for
   * its next model step. Session initialization uses
   * {@link setEscalationPolicy} directly because there is no previously
   * visible policy to change.
   * @param agent - the live agent whose policy is changing.
   * @param policy - the new effective policy.
   */
  setPolicy(agent: Agent, policy: EscalationPolicy): void {
    const previous = this.effectivePolicy(agent.session)
    if (previous === policy) return
    setEscalationPolicy(agent.session, policy)
    agent.inject(createUserMessage({
      content: [{
        type: 'text',
        text: `The escalation policy changed from "${previous}" to "${policy}" (changed by the user).`,
      }],
      source: { kind: 'plugin', plugin: 'escalation-policy' },
    }))
  }

  /**
   * Ask the composed answerers to decide one readonly same-process escalation
   * request. The service borrows the request, agent, session, and live signal
   * directly. The request requires an open turn because the audit pair must
   * be enclosed by the durable log's commit/replay boundary; an idle ask
   * rejects before appending anything. The answerer phase always produces an
   * outcome: an aborted signal yields `'cancelled'`, a missing or throwing
   * answerer yields `'unavailable'` (fail closed), and a rogue non-vocabulary
   * return value is normalized to `'unavailable'`. A failure that prevents
   * either audit append from committing still rejects because returning an
   * unlogged decision would violate the pair. Session contains post-commit
   * observer failures, so an authoritative append cannot reject the request
   * or suppress its matching audit event.
   * @param req - the pending escalation decision (agent, tool identity, target, justification, signal).
   * @returns the closed outcome; `'allowed-once'` is the only grant.
   * @throws when no turn is open or either audit event fails before the session
   *   append commit point.
   */
  async request(req: EscalationRequest): Promise<EscalationOutcome> {
    const session = req.agent.session
    if (!hasOpenTurn(session.snapshotEvents())) {
      throw new Error(
        'escalation.request() outside an open turn: the escalation/asked + escalation/decided audit pair '
        + 'must be turn-enclosed (a bare event between turns is crash-tail garbage on reload). '
        + 'Ask from inside the turn that needs the decision.',
      )
    }
    const id = EscalationRequestId(randomUUID())
    session.append('escalation/asked', {
      id,
      toolName: req.toolName,
      target: req.target,
      reason: escalationReason(req.target, req.justification),
      ...req.callId !== undefined ? { callId: req.callId } : {},
    })
    const outcome = await this.decide(req, session)
    session.append('escalation/decided', { id, outcome })
    return outcome
  }

  /**
   * The session's effective policy: its own `escalation/policy` fold, else the
   * configured default (the schema already defaulted an omitted policy to
   * `'ask'`; the `??` only narrows the optional-input TYPE).
   * @param session - the exact accepted session whose policy applies.
   * @returns the policy every ask for this session resolves under right now.
   */
  private effectivePolicy(session: Session): EscalationPolicy {
    return this.overrideOf(session) ?? this.config.policy ?? 'ask'
  }

  /**
   * Read the session override without applying the configured default.
   * @param session - session whose log supplies the override.
   * @returns the last logged policy, or `undefined` without one.
   */
  overrideOf(session: Session): EscalationPolicy | undefined {
    return effectiveEscalationPolicy(session.snapshotEvents())
  }

  /**
   * The session's current policy — its override, else the configured default.
   * @param events - the session's events in log order.
   * @returns the effective policy.
   */
  current(events: readonly SessionEvent[]): EscalationPolicy {
    return effectiveEscalationPolicy(events) ?? this.config.policy ?? 'ask'
  }

  /**
   * Pin the current {@link defaultPolicy} into a session only when it has
   * never recorded an `escalation/policy` event and is not a resumed seed:
   * the durable event is what makes the setting replay-stable (a fresh
   * session's pinned default must reconstruct identically after the user
   * changes the default later). Seeded historical sessions keep whatever
   * policy reality their own log carries and fall back to the composition
   * config at fold time.
   * @param session - the session to pin (newly created or already present at mount).
   */
  private pinInitialPolicy(session: Session): void {
    const events = session.snapshotEvents()
    if (effectiveEscalationPolicy(events) !== undefined) return
    if (events.some(event => event.type === 'session/end-seed')) return
    setEscalationPolicy(session, this.defaultPolicy)
  }

  /**
   * Build the whole select value for one folded policy state: every policy in
   * declaration order, current value the override or the composition default.
   * @param state - the folded policy override (null without one).
   * @returns the `escalation` projection payload.
   */
  selectFor(state: EscalationPolicy | null): EscalationSelect {
    const currentValue = state ?? this.config.policy ?? 'ask'
    const optionOf = (policy: EscalationPolicy): EscalationOption => {
      const presentation = POLICY_PRESENTATION[policy]
      return {
        value: policy,
        name: presentation.name,
        ...presentation.description === undefined ? {} : { description: presentation.description },
      }
    }
    return { options: ESCALATION_POLICIES.map(optionOf), currentValue }
  }

  /**
   * Decide the escalation after the audit `asked` event: aborted signals win,
   * deterministic policies resolve here (before any dispatch, so a prepended
   * listener can never reorder the 'deny'/'allow' promise), and the `'ask'`
   * policy delegates to the composed answerer chain, contained and raced
   * against the request signal.
   * @param req - the borrowed public request.
   * @param session - the request agent's session used for policy lookup.
   * @returns the normalized closed outcome.
   */
  private async decide(req: EscalationRequest, session: Session): Promise<EscalationOutcome> {
    const signal = req.signal
    if (signal?.aborted) return 'cancelled'
    // The 'deny'/'allow' policies are decided HERE, before any dispatch: a
    // listener registered with `prepend: true` after this service mounts
    // would sit ahead of any gate LISTENER, so a listener-shaped gate cannot
    // keep the documented promise that 'deny'/'allow' resolve
    // deterministically regardless of registration order — only the service's
    // own request path can.
    const policy = this.effectivePolicy(session)
    if (policy === 'deny') return 'rejected'
    if (policy === 'allow') return 'allowed-once'
    // Enter the promise chain BEFORE dispatching: a listener that throws
    // SYNCHRONOUSLY (before its first await) must land in the same rejection
    // path as an async one — `Promise.resolve(call())` would let it escape
    // the containment into the caller.
    const answer: Promise<EscalationOutcome> = Promise.resolve().then(
      () => this.ctx.waterfall(
        scopeTarget(this, req.agent), 'escalation/request', req,
        () => Promise.resolve<EscalationOutcome>('unavailable'),
      ),
    ).then(
      // Normalize a rogue (non-vocabulary) answerer return to the fail-closed
      // outcome instead of leaking it into callers' closed-union switches.
      outcome => OUTCOMES.includes(outcome) ? outcome : 'unavailable',
      // A throwing answerer must fail the QUESTION closed, not the caller's
      // tool call open — the seam contains its callbacks.
      () => 'unavailable',
    )
    if (signal === undefined) return answer
    return await new Promise<EscalationOutcome>((resolve) => {
      const onAbort = () => {
        signal.removeEventListener('abort', onAbort)
        resolve('cancelled')
      }
      signal.addEventListener('abort', onAbort, { once: true })
      void answer.then((outcome) => {
        signal.removeEventListener('abort', onAbort)
        // After an abort won the race this resolve is a settled-promise no-op:
        // the late answer is discarded by construction.
        resolve(outcome)
      })
    })
  }
}

export default EscalationService
