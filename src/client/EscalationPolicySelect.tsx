// EscalationPolicySelect: the small per-session escalation-policy icon in the
// composer tool row, right beside the Access chip. It reads the host `escalation`
// projection (three options + effective current policy), shows a shield glyph
// that reflects the policy, and on a pick submits the `/escalation <policy>`
// command (the one write path). A small always-visible control per
// `conversation.input.left`: no text label, matching its one-row height budget.

import { useEffect, useState } from 'react'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { EscalationPolicy, EscalationSelect } from '../types.ts'
import type { EscalationKey } from './locales.ts'
import css from './EscalationPolicySelect.module.css'

const shieldOutline = 'M8.20554 0.899994L14.7901 3.36857V7.01026C14.7901 12 11.0466 14.2103 8.20554 15.3C5.36446 14.2103 1.62012 12 1.62012 7.01026V3.36857L8.20554 0.899994Z'

/** Shield glyphs (design set 1556 family): plain = ask, slash = auto deny, check = always allow. */
const policyGlyphs: Record<EscalationPolicy, React.ReactNode> = {
  ask: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d={shieldOutline} stroke="currentColor" strokeWidth="1.31831" strokeLinejoin="round" />
    </svg>
  ),
  deny: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d={shieldOutline} stroke="currentColor" strokeWidth="1.31831" strokeLinejoin="round" />
      <path d="M3.5 12.5L12.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  allow: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d={shieldOutline} stroke="currentColor" strokeWidth="1.31831" strokeLinejoin="round" />
      <path d="M5.2 8L7.1 9.9L10.9 6.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
}

/** Locale key for one escalation policy option (the host names stay English). */
const OPTION_LABEL: Record<EscalationPolicy, EscalationKey> = {
  ask: 'option.ask',
  deny: 'option.deny',
  allow: 'option.allow',
}

/** Injected + owner + standard faces the registered entry threads into the plain presentation component. */
export interface EscalationPolicySelectProps {
  /** The session's escalation select (undefined = escalation capability absent → hides the icon). */
  value: EscalationSelect | undefined
  /** Composer-locked: the trigger disables and any open menu closes. */
  locked: boolean
  /** Submit one write-path line (`/escalation <policy>`); resolves whether the host matched it. */
  command: (line: string) => Promise<boolean>
  /** The locale seat (conversation dictionary). */
  t: (key: EscalationKey, params?: Record<string, string>) => string
}

export function EscalationPolicySelect({ value, locked, command, t }: EscalationPolicySelectProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!locked) return
    setOpen(false)
  }, [locked])

  if (value === undefined) return null

  const current = value.options.find(option => option.value === value.currentValue)
  const items: MenuEntry[] = value.options.map(option => ({
    id: option.value,
    label: t(OPTION_LABEL[option.value]),
    icon: policyGlyphs[option.value],
  }))

  const submit = (id: string): void => {
    setBusy(true)
    void command(`/escalation ${id}`).catch(() => false).finally(() => { setBusy(false) })
  }
  const choose = (id: string): void => {
    setOpen(false)
    if (id === value.currentValue) return
    submit(id)
  }

  return (
    <Menu
      open={open}
      items={items}
      selectedId={value.currentValue}
      onSelect={choose}
      onClose={() => { setOpen(false) }}
      side="top"
      anchor={
        <button
          type="button"
          className={css.trigger}
          aria-label={t('access', { name: current?.name ?? value.currentValue })}
          title={current?.name}
          disabled={locked || busy}
          onClick={() => { setOpen(!open) }}
        >
          <span className={css.triggerIcon} aria-hidden>{policyGlyphs[value.currentValue]}</span>
        </button>
      }
    />
  )
}

/** Injected face of the `conversation.input.left` escalation entry (the navigation-bound). */
export interface EscalationPolicyEntryInjected {
  /** Submit one `/escalation` line against the calling session; resolves whether the host matched it. */
  command: (line: string) => Promise<boolean>
}

/** Composed props of the registered `conversation.input.left` escalation entry. */
export type EscalationPolicyEntryProps =
  PropsRuntime<'conversation.input.left'>
  & PropsLocale<'escalation'>
  & EscalationPolicyEntryInjected

/**
 * The registered composer-row entry: bridges the framework projection seat,
 * the session-locked lifecycle flag, and the injected command executor into
 * the plain presentation component. Renders nothing while the `escalation`
 * projection is absent (escalation capability not composed).
 * @param props - the standard kit, the injected command executor, and the locale seat.
 */
export function EscalationPolicyEntry({ useProjection, useSession, sessionId, command, t }: EscalationPolicyEntryProps) {
  const value = useProjection('escalation')
  const session = useSession(snapshot => snapshot)
  return (
    <EscalationPolicySelect
      value={value}
      locked={session?.removed ?? true}
      // `command` closes over the calling session, so only the line is passed.
      command={line => command(line)}
      t={t}
    />
  )
}
