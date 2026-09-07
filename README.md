---
description: "The channel-specific sandbox-escalation seam for users and maintainers choosing, composing, or debugging fail-closed sandbox escalation policy."
kind: "package-reference"
---

# dsh-escalation-policy

Standalone DeepSeek Harness plugin: the channel-specific sandbox-escalation
seam (`ctx.escalation`). Install it into a profile with:

```sh
dsh plugin --profile web add github:iimaguest/dsh-escalation-policy
```

It mounts as the `escalation` row, defaulting to `ask` under
`workspace-write` permission mode and `deny` under `danger-full-access`.

English | [中文](README.zh.md)

## Summary

`dsh-escalation-policy` owns `ctx.escalation`, the channel-specific sandbox-escalation seam separated from generic approval by structure. `ctx.escalation.request(req)` returns `allowed-once`, `rejected`, `cancelled`, or `unavailable`; missing or failing answerers fail closed, and a grant applies only to the one requested mode. Sandbox-enforcing tools (bash, pwsh, fs) route strictly-wider retries through this seam instead of `approval/request`, so escalation is judged by its own channel — never by matching generic-approval text. Mount it when sandbox escalation retries must be judged separately from ordinary approvals and fail closed without an answerer.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount `dsh-escalation-policy` when a deployment must route strictly-wider sandbox retries through their own policy channel. The service composes with the sandbox-enforcing tools; the tools call `ctx.escalation.request()` for a wider retry, and the answerer chain or the configured policy decides.

### Ask for an escalation

Each request must belong to an open agent turn. The service appends a paired `escalation/asked` and `escalation/decided` audit record, while the model sees only the resulting logged tool outcome. An aborted request resolves `cancelled`; an audit append that fails before commit rejects rather than returning an unlogged decision.

Answerers are `escalation/request` waterfall listeners, structurally disjoint from `approval/request` answerers. Return an outcome to answer for an owned agent or call `next()` to delegate. Agent-scoped listeners receive only that agent's requests; compose one terminal answerer per deployment because sibling listener order is not a policy priority mechanism.

### Configure the policy

`EscalationPolicy` is `'ask'`, `'deny'`, or `'allow'`. The effective value is the last `escalation/policy` event, falling back to config; `setEscalationPolicy()` is the write path. The `escalation` General-settings namespace (default: `config.policy`, else `ask`) pins the chosen policy as a durable `escalation/policy` event into each genuinely fresh (non-resumed) session at creation, so every new session starts from the current default and a later default change never rewrites an already-created session. `'deny'` rejects before interactive dispatch, `'allow'` grants before interactive dispatch, and `'ask'` consults the answerer chain. All three policies contribute their complete current meaning to the cache-safe runtime-context snapshot. The optional `escalation` session projection and the `/escalation` command activate only when the projection or command registry is composed.

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-escalation-policy) is the exhaustive source for every accepted field.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the seam separates escalation from approval; the observable behavior is covered in [Use this package](#use-this-package).

### The channel split

Escalation requests never travel the generic-approval waterfall: `ctx.escalation.request` dispatches through the `escalation/request` waterfall, so a strictly-wider retry is judged by the escalation policy, not by matching generic-approval text. The paired `escalation/asked` and `escalation/decided` events stay log-only, so the model sees only the asking consumer's result.

### The policy fold

The effective policy is the last `escalation/policy` event, falling back to config. The `escalation` General-settings namespace pins the chosen policy as a durable event into each genuinely fresh session at creation, so a later default change never rewrites an already-created session.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service Definition, escalation policy fold, request dispatch |
| [`src/types.ts`](src/types.ts) | Closed policy, ask id, and outcome vocabulary |
| [`src/client.ts`](src/client.ts) | Client-namespace projection of the domain types |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion: escalation audit stream stays consistent |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

The seam separates escalation from generic approval; read these pages for the surrounding approval contract and the sandbox design rationale.

- [user-approval](../user-approval/README.md) — the generic approval seam escalation is structurally separate from.
- [sandbox Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md) — the sandbox escalation design rationale.
- [escalation Agent Note](../../../.agents/notes/implemented/architecture/2026-08-22-escalation-channel.md) — the escalation channel design rationale.
- [escalation subsystem](../../../docs/subsystems/escalation.md) — the escalation subsystem page.

-----

<a id="model-experience"></a>
## Model Experience

### Current escalation policy context

#### What the model sees

The first request and each effective policy change append a full runtime-context snapshot after retained history. Under `ask`, the escalation contribution states that configured answerers may be consulted and absence fails closed. Under `deny`, it states the deterministic rejection and tells the model not to request escalation. Under `allow`, it states that a strictly-wider retry is granted automatically. Unchanged requests retain the earlier snapshot without adding another message.

##### Ask-policy contribution

```markdown
Escalation policy: ask. Sandbox escalation retries (sandbox_permissions with a justification) may ask through the configured answerers; without an available answerer the retry fails closed.
```

##### Deny-policy contribution

```markdown
Escalation policy: deny. Sandbox escalation retries (sandbox_permissions with a justification) are auto-denied in this session — do not request sandbox escalation (do not set sandbox_permissions).
```

##### Allow-policy contribution

```markdown
Escalation policy: allow. A strictly-wider sandbox escalation retry (sandbox_permissions with a justification) is granted automatically in this session without asking the user.
```

#### Token effect

One concise context message on the first request and on an effective change; unchanged requests add no duplicate policy tokens.

#### KV Cache effect

Append-only after retained history. An `ask`/`deny`/`allow` switch preserves the stable system and conversation prefix instead of rewriting the first wire message.

### Tool outcome

#### What the model sees

`escalation/asked` and `escalation/decided` are log-only. The model sees only the asking consumer's eventual allowed, rejected, cancelled, or unavailable tool outcome; the human permission UI is not context.

#### Token effect

Zero duplicate audit tokens. A rejection may replace a normal tool result with a small retained error, while an allowance or denial returns the ordinary result stamped with the granted (or standing) mode.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the seam is a poor fit or needs special care. They are current package constraints, not a task backlog.

- **Requests are valid only inside an open turn** — an idle or between-turn caller throws before auditing; a durable out-of-turn escalation workflow is deferred.
- **Policy is per-target-agnostic** — one `ask`/`deny`/`allow` governs every strictly-wider retry; a target-specific policy (deny only `danger-full-access`, say) is a natural follow-up on the same channel.
- **`allow` carries no persistence of grants** — each escalation is one-shot; there is no remembered rule or revocation store.
- **No built-in answerer** — headless or incompletely composed deployments resolve `unavailable` and fail closed; the service itself never prompts a human.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers; it is explicitly non-authoritative. The seam stays structurally separate from generic approval by design; a target-specific policy and a built-in answerer remain deferred.

</details>
