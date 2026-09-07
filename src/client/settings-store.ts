/**
 * Escalation default-settings controller (the permission row's pattern, on the
 * escalation namespace): the descriptor comes from the shared describe mirror;
 * writes target only `defaultPolicy`, carry the descriptor revision, and fold
 * their answer back into the mirror so the host settings doc and this row stay
 * one source of truth.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import {
  createSnapshotStore, type SnapshotStore,
} from '@deepseek-ai/dsh-client-store'
import type {
  SchemaNode, SettingsDescribeFace, SettingsSchemaService,
} from '@deepseek-ai/dsh-client-ui-settings/client'

/** Escalation's settings namespace on the host wire. */
export const ESCALATION_SETTINGS_NS = 'escalation'

/** One selectable new-session escalation-policy default. */
export interface EscalationDefaultOption {
  /** Policy key written to Settings. */
  id: string
  /** Host-supplied label or a title-cased policy key. */
  label: string
}

/** Escalation settings-row snapshot. */
export interface EscalationSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'unavailable' | 'error'
  error: string | null
  writable: boolean
  currentValue: string
  options: readonly EscalationDefaultOption[]
  revision: number
}

interface ConstChoice {
  type: string
  value?: unknown
  meta?: { description?: unknown }
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/**
 * Read the dynamic policy enum encoded by the host's `defaultPolicy` schema.
 * @param view - escalation namespace descriptor.
 * @param schema - settings schema operations.
 * @returns current value and selectable options.
 */
export function escalationDefaultOf(view: SettingsNamespaceView, schema: SettingsSchemaService): {
  currentValue: string
  options: EscalationDefaultOption[]
} {
  const value = (view.value as { defaultPolicy?: unknown } | null)?.defaultPolicy
  if (typeof value !== 'string') throw new Error('escalation settings has no defaultPolicy value')
  const node = schema.nodeAtPath(schema.rehydrate(view.schema), ['defaultPolicy'])
  if (node === undefined) throw new Error('escalation settings schema has no defaultPolicy field')
  const rawChoices = node.type === 'union'
    ? (node.list as SchemaNode[] | undefined) ?? []
    : [node]
  const options = rawChoices.flatMap((candidate) => {
    const choice = candidate as unknown as ConstChoice
    if (choice.type !== 'const' || typeof choice.value !== 'string') return []
    const described = choice.meta?.description
    return [{
      id: choice.value,
      label: typeof described === 'string' && described.length > 0
        ? described
        : titleCase(choice.value),
    }]
  })
  if (options.length === 0 || !options.some(option => option.id === value)) {
    throw new Error('escalation settings schema does not advertise its current policy')
  }
  return { currentValue: value, options }
}

/** Controller deriving the row from the shared mirror and writing the default through it. */
export class EscalationPolicySettingsController {
  /** Row snapshot consumed through a bound selector hook. */
  readonly store: SnapshotStore<EscalationSettingsState> = createSnapshotStore({
    status: 'idle',
    error: null,
    writable: false,
    currentValue: '',
    options: [],
    revision: 0,
  })

  private following: (() => void) | undefined
  private saving = false
  private disposed = false

  /**
   * @param describeFace - the shared mirror's read/fold face (descriptor and schema source).
   * @param ctx - the row plugin's context, whose `remote.settings` namespace
   * carries the `defaultPolicy` write.
   * @param schema - settings-owned schema operations.
   */
  constructor(
    private readonly describeFace: SettingsDescribeFace,
    private readonly ctx: ClientContext,
    private readonly schema: SettingsSchemaService,
  ) {}

  /**
   * Begin following the mirror (idempotent) and reflect its current answer.
   * @returns settlement once the snapshot reflects the mirror.
   */
  async load(): Promise<void> {
    if (this.disposed) return
    this.following ??= this.describeFace.subscribe(() => { this.derive() })
    this.store.update((state) => {
      state.status = 'loading'
      state.error = null
    })
    await this.describeFace.ensure()
    this.derive()
  }

  /**
   * Persist one policy as the default for subsequently created sessions.
   * A selection made while one is already saving is ignored — the row's
   * control is disabled during the save.
   * @param policy - advertised policy key.
   * @returns nothing; {@link store} carries success or failure.
   */
  async select(policy: string): Promise<void> {
    const state = this.store.getSnapshot()
    const view = this.describeFace.getSnapshot().view?.namespaces
      .find(entry => entry.ns === ESCALATION_SETTINGS_NS)
    if (view === undefined || !state.writable || this.saving) return
    this.saving = true
    this.store.update((draft) => {
      draft.status = 'saving'
      draft.error = null
    })
    let response
    try {
      response = await this.ctx.remote.settings.mutate(
        ESCALATION_SETTINGS_NS,
        [{ op: 'set', path: ['defaultPolicy'], value: policy }],
        view.revision,
      )
    } finally {
      // Cleared before the fold below, whose publish reaches `derive` through
      // this row's own subscription and is skipped while a save is pending.
      this.saving = false
    }
    if (this.disposed) return
    if (!response.ok) {
      this.fail(response.error)
      return
    }
    // The mirror publish reaches this row's own subscription, so the fold
    // is also what republishes the accepted value here.
    this.describeFace.acceptView(response.value)
  }

  /** Stop following the mirror; later publishes leave the snapshot alone. */
  dispose(): void {
    this.disposed = true
    this.following?.()
    this.following = undefined
  }

  private derive(): void {
    if (this.disposed || this.saving) return
    const mirrored = this.describeFace.getSnapshot()
    if (mirrored.status === 'unavailable') {
      this.store.update((state) => {
        state.status = 'unavailable'
        state.writable = false
        state.currentValue = ''
        state.options = []
      })
      return
    }
    if (mirrored.view === undefined) {
      if (mirrored.error !== null) this.fail(new Error(mirrored.error))
      return
    }
    const view = mirrored.view.namespaces.find(entry => entry.ns === ESCALATION_SETTINGS_NS)
    if (view === undefined) {
      this.store.update((state) => {
        state.status = 'unavailable'
        state.writable = false
        state.currentValue = ''
        state.options = []
      })
      return
    }
    try {
      const resolved = escalationDefaultOf(view, this.schema)
      const { writable } = mirrored.view
      this.store.update((state) => {
        state.status = 'ready'
        state.error = null
        state.writable = writable
        state.currentValue = resolved.currentValue
        state.options = resolved.options
        state.revision = view.revision
      })
    } catch (error) {
      this.fail(error)
    }
  }

  private fail(error: unknown): void {
    this.store.update((state) => {
      state.status = 'error'
      state.error = error instanceof Error ? error.message : String(error)
    })
  }
}
