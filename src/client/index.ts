/**
 * Escalation surface plugin, browser half: the composer shield icon beside the
 * Access chip (`conversation.input.left`) and the new-session default policy
 * row in General settings (`settings.general.item`). The shield reads the host
 * `escalation` projection (three options + effective current policy) and
 * submits the `/escalation <policy>` command line against the calling session;
 * the row writes the `escalation` settings namespace through the shared
 * describe mirror. Both render nothing while the capability is not composed.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the Session Controller service used to submit command lines.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the conversation composer slot types.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the renderer-owned slots service.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Session standard useProjection seat.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the settings slot types (this package registers a General row).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { EscalationPolicyEntry } from './EscalationPolicySelect.tsx'
import { EscalationPolicyRow, type EscalationPolicyRowInjected } from './EscalationPolicyRow.tsx'
import { EscalationPolicySettingsController } from './settings-store.ts'
import { settingsEn, settingsZh, type EscalationSettingsKey } from './settings-locales.ts'
import { en, zh, type EscalationKey } from './locales.ts'

export { EscalationPolicyEntry } from './EscalationPolicySelect.tsx'
export type { EscalationPolicyEntryProps } from './EscalationPolicySelect.tsx'
export { EscalationPolicyRow } from './EscalationPolicyRow.tsx'
export type { EscalationPolicyRowProps, EscalationPolicyRowInjected } from './EscalationPolicyRow.tsx'
export type { EscalationKey } from './locales.ts'
export type { EscalationSettingsKey } from './settings-locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The escalation shield copy. */
    escalation: EscalationKey
    /** The escalation default row copy. */
    'settings.escalation': EscalationSettingsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'escalation'
/** Settings row namespace owned by this plugin. */
const SETTINGS_NS = 'settings.escalation'

/** Required services (cordis fiber inject). */
export const inject = [
  'slots', 'sessions', 'locale', 'remote', 'remote.settings', 'settingsScope',
  'settingsSchema',
]

/**
 * Client plugin body: register the composer shield entry over the escalation
 * projection.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'escalation: dictionaries')
  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh: settingsZh, en: settingsEn }), 'escalation: settings row dictionaries')

  const sessions = ctx.sessions

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'escalation',
    order: 0,
    locale: NS,
    inject: (sessionId: SessionId): { command: (line: string) => Promise<boolean> } => ({
      command: async (line) => {
        const face = sessions.binding(sessionId)?.session
        if (face === undefined) return false
        const result = await face.command(line)
        return result.ok === true && result.value?.matched === true
      },
    }),
  }, EscalationPolicyEntry))

  // The shared SettingsScope mirror updates after document commits and reconnects.
  const controller = new EscalationPolicySettingsController(
    ctx.settingsScope.describe(), ctx, ctx.settingsSchema)
  const load = (): Promise<void> => controller.load()
  const select = (policy: string): Promise<void> => controller.select(policy)
  const injected = (): EscalationPolicyRowInjected => ({
    hooks: { escalationPolicy: controller.store },
    load,
    select,
  })

  ctx.effect(() => () => { controller.dispose() }, 'escalation: settings row directory')

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'escalation',
    order: -10,
    locale: SETTINGS_NS,
    inject: injected,
  }, EscalationPolicyRow))
}
