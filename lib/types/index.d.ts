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
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { type ToolCallId } from '@deepseek-ai/dsh-llm';
import { type Scoped } from '@deepseek-ai/dsh-scope';
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings';
import type { EscalationOutcome, EscalationPolicy, EscalationSelect } from './types.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        escalation: EscalationService;
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
        'escalation/request'(this: Scoped<EscalationService>, req: EscalationRequest, next: () => Promise<EscalationOutcome>): Promise<EscalationOutcome>;
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
            id: EscalationRequestId;
            toolName: string;
            callId?: ToolCallId;
            /** The requested sandbox mode (already validated strictly wider by the asking tool). */
            target: string;
            reason?: string;
        };
        /**
         * The outcome of a prior `escalation/asked` (same `id`) — log-only audit.
         * Exactly one per ask, appended when the outcome is known: a decision, a
         * cancellation, or the fail-closed `'unavailable'`.
         */
        'escalation/decided': {
            id: EscalationRequestId;
            outcome: EscalationOutcome;
        };
        /**
         * The session's escalation policy was switched — log-only, durable,
         * replayable, never in the model transcript (the model learns the policy
         * from the runtime-context snapshot and live switch notices). The LAST
         * such event is the session's override ({@link effectiveEscalationPolicy}).
         * `source: 'delegation'` marks an override seeded into a child; an absent
         * source is a runtime switch.
         */
        'escalation/policy': {
            policy: EscalationPolicy;
            /** Marks an override seeded into a child at delegation. */
            source?: 'delegation';
        };
    }
}
import { EscalationRequestId } from './types.ts';
export { EscalationRequestId } from './types.ts';
export type { EscalationOption, EscalationOutcome, EscalationPolicy, EscalationSelect } from './types.ts';
export type * from './types.ts';
/** Every {@link EscalationPolicy}, in advertisement order (option order and validation vocabulary). */
export declare const ESCALATION_POLICIES: readonly EscalationPolicy[];
/** Settings namespace carrying the default escalation policy for future sessions. */
export declare const ESCALATION_SETTINGS_NAMESPACE: SettingsNamespace;
/**
 * Runtime validation of untrusted escalation-policy strings.
 * @param value - the raw policy value.
 * @returns whether the value is one of the closed policy vocabulary.
 */
export declare function isEscalationPolicy(value: string): value is EscalationPolicy;
/**
 * The session's escalation-policy override: the last `escalation/policy`
 * event in the log, or undefined when the session never switched (callers
 * apply the service's configured default). The pure fold — resume needs no
 * catch-up machinery because replaying the log IS the state.
 * @param events - session events in log order (other event types are skipped).
 * @returns the policy of the last switch event, or undefined without one.
 */
export declare function effectiveEscalationPolicy(events: readonly SessionEvent[]): EscalationPolicy | undefined;
/**
 * Append the sole durable representation of a session escalation-policy
 * override. Invalid values throw before the log changes; consumers fold the
 * new value on each read.
 * @param session - the session the override belongs to.
 * @param policy - the policy in effect until the next switch.
 */
export declare function setEscalationPolicy(session: Session, policy: EscalationPolicy): void;
/**
 * The audit/headline reason for one escalation ask — the single human-readable
 * sentence both the audit trail and the GUI presentation use.
 * @param target - the requested sandbox mode.
 * @param justification - the model's one-sentence reason.
 * @returns the full reason sentence.
 */
export declare function escalationReason(target: string, justification: string): string;
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
    readonly agent: Agent;
    /** The tool the retry is about (presentation and audit). */
    readonly toolName: string;
    /**
     * The exact tool call being decided, when the asker has one — lets a UI
     * attach the prompt to the tool call it already streamed.
     */
    readonly callId?: ToolCallId;
    /** The requested sandbox mode (strictly wider than the call's effective mode — validated by the asking tool). */
    readonly target: string;
    /** The model's one-sentence reason, shown verbatim to the user (and stored in the audit reason). */
    readonly justification: string;
    /**
     * Aborting withdraws the question: the request settles `'cancelled'`
     * immediately and a late answer from a still-pending answerer is discarded.
     */
    readonly signal?: AbortSignal;
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
    readonly policy?: EscalationPolicy;
}
/** User setting resolved when a new session receives its initial escalation policy. */
export interface EscalationSettings {
    /** Policy pinned into a newly created session. */
    defaultPolicy: EscalationPolicy;
}
/**
 * Escalation service that applies session policy before answerers and logs
 * every ask/outcome pair to the requesting session. It exposes deterministic
 * policy changes to the model through the runtime-context snapshot and switch
 * notices, and publishes the `escalation` session projection plus the
 * `/escalation` command when their registries are composed.
 */
export declare class EscalationService extends Service {
    config: Config;
    static Config: z<Config>;
    /** The settings source resolving the policy pinned into new sessions. */
    private defaultSettings;
    constructor(ctx: Context, config: Config);
    /**
     * The current default escalation policy for subsequently created sessions:
     * the user settings value, else the composition config default.
     * @returns the policy the next genuinely fresh session is pinned with.
     */
    get defaultPolicy(): EscalationPolicy;
    /**
     * Switch one live agent's escalation policy and queue the transition for
     * its next model step. Session initialization uses
     * {@link setEscalationPolicy} directly because there is no previously
     * visible policy to change.
     * @param agent - the live agent whose policy is changing.
     * @param policy - the new effective policy.
     */
    setPolicy(agent: Agent, policy: EscalationPolicy): void;
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
    request(req: EscalationRequest): Promise<EscalationOutcome>;
    /**
     * The session's effective policy: its own `escalation/policy` fold, else the
     * configured default (the schema already defaulted an omitted policy to
     * `'ask'`; the `??` only narrows the optional-input TYPE).
     * @param session - the exact accepted session whose policy applies.
     * @returns the policy every ask for this session resolves under right now.
     */
    private effectivePolicy;
    /**
     * Read the session override without applying the configured default.
     * @param session - session whose log supplies the override.
     * @returns the last logged policy, or `undefined` without one.
     */
    overrideOf(session: Session): EscalationPolicy | undefined;
    /**
     * The session's current policy — its override, else the configured default.
     * @param events - the session's events in log order.
     * @returns the effective policy.
     */
    current(events: readonly SessionEvent[]): EscalationPolicy;
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
    private pinInitialPolicy;
    /**
     * Build the whole select value for one folded policy state: every policy in
     * declaration order, current value the override or the composition default.
     * @param state - the folded policy override (null without one).
     * @returns the `escalation` projection payload.
     */
    selectFor(state: EscalationPolicy | null): EscalationSelect;
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
    private decide;
}
export default EscalationService;
//# sourceMappingURL=index.d.ts.map