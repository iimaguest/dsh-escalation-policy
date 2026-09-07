/** `settings.escalation` namespace dictionaries (the Escalation row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const settingsZh = {
  'title': '升级权限',
  'description': '选择新会话的默认升级权限模式',
  'loading': '加载中',
  'unavailable': '不可用',
} satisfies Record<string, string>

/** The settings.escalation namespace key union. */
export type EscalationSettingsKey = keyof typeof settingsZh

/** English dictionary, checked complete against the zh key set. */
export const settingsEn = {
  'title': 'Escalation',
  'description': 'Choose the default escalation mode for new sessions',
  'loading': 'Loading',
  'unavailable': 'Unavailable',
} satisfies Record<EscalationSettingsKey, string>
