/**
 * Escalation preference row: the default escalation-policy for subsequently
 * created sessions. Current-session switches remain on the composer shield
 * icon (`/escalation`); this row writes the host `escalation` settings
 * namespace through the shared describe mirror.
 */

import { useEffect, useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconChevronDownOutline14, Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { EscalationSettingsState } from './settings-store.ts'
import type { EscalationSettingsKey } from './settings-locales.ts'
import css from './EscalationPolicyRow.module.css'

/** Registration-side business face for the host-backed escalation default. */
export interface EscalationPolicyRowInjected {
  hooks: {
    /** Escalation settings snapshot bound by the renderer as useEscalationPolicy. */
    escalationPolicy: SnapshotStore<EscalationSettingsState>
  }
  /** Load the descriptor when the row first renders. */
  load: () => Promise<void>
  /** Persist one advertised policy. */
  select: (policy: string) => Promise<void>
}

/** Full component props. */
export type EscalationPolicyRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.escalation'>
  & InjectFace<EscalationPolicyRowInjected>

/**
 * Render the new-session escalation-policy default selector.
 * @param props - composed slot props.
 * @returns the row, or null when the host does not expose escalation settings.
 */
export function EscalationPolicyRow({ load, select, useEscalationPolicy, t }: EscalationPolicyRowProps) {
  const state = useEscalationPolicy(snapshot => snapshot)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (state.writable && state.status !== 'unavailable') return
    setOpen(false)
  }, [state.status, state.writable])

  if (state.status === 'unavailable') return null
  const selected = state.options.find(option => option.id === state.currentValue)
  const busy = state.status === 'loading' || state.status === 'saving'
  const label = selected?.label
    ?? (busy ? t('loading') : t('unavailable'))
  const description: string = state.error ?? t('description')

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('title')}</div>
        <div className={css.desc} role={state.error === null ? undefined : 'alert'}>{description}</div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={state.options.map(option => ({ id: option.id, label: option.label }))}
        selectedId={state.currentValue}
        onSelect={(id) => {
          setOpen(false)
          if (id === state.currentValue) return
          void select(id)
        }}
        align="end"
        portal
        anchor={(
          <button
            type="button"
            className={css.selector}
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={busy || !state.writable || state.options.length === 0}
            onClick={() => { setOpen(value => !value) }}
          >
            {label}
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Escalation default row copy. */
    'settings.escalation': EscalationSettingsKey
  }
}
