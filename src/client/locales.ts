/** `escalation` namespace dictionaries (the composer shield + settings row copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'access': '升级策略，当前：{name}',
  'option.ask': '询问升级',
  'option.deny': '自动拒绝',
  'option.allow': '始终允许',
} satisfies Record<string, string>

/** The escalation namespace key union. */
export type EscalationKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'access': 'Escalation mode, current: {name}',
  'option.ask': 'Ask escalation',
  'option.deny': 'Auto deny',
  'option.allow': 'Always allow',
} satisfies Record<EscalationKey, string>
