/**
 * Pure types of the escalation-policy domain: the closed escalation-policy
 * vocabulary, the escalation ask identifier and outcome vocabulary, and the
 * `escalation` projection-key declaration. Free of this package's host-side
 * value imports (cordis, schemastery, zod) so browser type chains (apiproxy
 * api → client) and the projection face can consume them without loading the
 * Context augmentation. Two namespace projections serve it — the package root
 * re-export for host consumers, `./client` for client aggregates — with zero
 * content duplication.
 *
 * @module @deepseek-ai/dsh-escalation-policy/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * One session's escalation policy — what happens to a sandbox-escalation ask
 * (`escalation/request`) BEFORE any interactive answerer sees it:
 *
 * - `'ask'` (the default) — delegate to the composed answerers; with none
 *   composed the chain falls through to the fail-closed `'unavailable'`.
 * - `'deny'` — never prompt anyone: every escalation ask resolves
 *   `'rejected'` deterministically (the strict headless stance, scoped to
 *   escalation instead of every approval).
 * - `'allow'` — auto-allow: every strictly-wider escalation ask resolves
 *   `'allowed-once'` without prompting (the pilot stance).
 */
export type EscalationPolicy = 'ask' | 'deny' | 'allow'

/**
 * Pairs one `escalation/asked` audit event with its `escalation/decided`.
 * Service-issued (one fresh id per {@link EscalationService.request} call).
 */
export type EscalationRequestId = Branded<'EscalationRequestId'>

/**
 * Brand a string as an {@link EscalationRequestId}.
 * @param id - the raw id string to brand.
 * @returns the same string carrying the brand.
 */
export function EscalationRequestId(id: string): EscalationRequestId {
  return id as EscalationRequestId
}

/**
 * Closed escalation outcomes: a one-shot grant, explicit rejection, withdrawn
 * request, or unavailable answerer. Callers fail closed on `unavailable`. The
 * vocabulary mirrors `ApprovalOutcome`; the escalation seam keeps its own
 * copy so neither seam's contract shifts with the other.
 */
export type EscalationOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** One select-option a presentation layer advertises for an escalation policy. */
export interface EscalationOption {
  /** The switchable policy value. */
  value: EscalationPolicy
  /** The display label. */
  name: string
  /** One user-facing sentence on what the value means; omitted when not configured. */
  description?: string
}

/**
 * Whole `escalation` projection value: the three switchable policies in order
 * and the effective current value (session override, else composition default).
 */
export interface EscalationSelect {
  /** The three switchable escalation policies, in declaration order. */
  options: EscalationOption[]
  /** The effective current policy for the session. */
  currentValue: EscalationPolicy
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * The session's escalation-policy select, folded from `escalation/policy`
     * over the composition default. Key absence means no escalation policy
     * service is composed — clients hide the control.
     */
    escalation: EscalationSelect
  }
}
