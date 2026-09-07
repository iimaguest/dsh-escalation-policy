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
/**
 * Brand a string as an {@link EscalationRequestId}.
 * @param id - the raw id string to brand.
 * @returns the same string carrying the brand.
 */
export function EscalationRequestId(id) {
    return id;
}
//# sourceMappingURL=types.js.map