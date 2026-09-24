import { inject, ref, watch, type InjectionKey } from 'vue'
import { enUS } from './messages/en-US'
import { zhCN, type MessageKey } from './messages/zh-CN'

export type Locale = 'zh-CN' | 'en-US'
type TranslationParams = Record<string, string | number>

const messages: Record<Locale, Record<MessageKey, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
}

// These are stored as Chinese values in existing projects; only their labels are translated.
const builtInLabels: Record<string, MessageKey> = {
  '旁白': 'system.narrator',
  '高兴': '高兴', '生气': '生气', '伤心': '伤心', '害怕': '害怕',
  '厌恶': '厌恶', '低落': '低落', '惊喜': '惊喜', '平静': '平静',
  '电话音': 'system.filterTelephone',
  '水下': 'system.filterUnderwater',
  '老广播': 'system.filterOldRadio',
  '机械失真': 'system.filterMechanical',
  '模拟电话通话时的窄频带声音': 'system.filterTelephoneDescription',
  '模拟在水下听到的闷声': 'system.filterUnderwaterDescription',
  '模拟老式收音机或广播的尖锐声音': 'system.filterOldRadioDescription',
  '模拟机器人或设备损坏时的失真声音': 'system.filterMechanicalDescription',
}

export function resolveLocale(language: string): Locale {
  return language.toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN'
}

function formatMessage(key: MessageKey, locale: Locale, params?: TranslationParams): string {
  const value = messages[locale][key]
  return params
    ? value.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match))
    : value
}

// Services can raise user-facing errors outside a component setup function.
export function translateForCurrentLocale(key: MessageKey, params?: TranslationParams): string {
  const language = typeof document === 'undefined' ? 'zh-CN' : document.documentElement.lang
  return formatMessage(key, resolveLocale(language), params)
}

export function createI18n(language: string) {
  const locale = ref<Locale>(resolveLocale(language))

  function setLocale(next: Locale) {
    locale.value = next
  }

  watch(locale, next => {
    document.documentElement.lang = next
    document.title = formatMessage('app.documentTitle', next)
  }, { immediate: true, flush: 'sync' })

  function t(key: MessageKey, params?: TranslationParams): string {
    return formatMessage(key, locale.value, params)
  }

  function displayBuiltIn(value: string): string {
    const key = builtInLabels[value]
    return key ? t(key) : value
  }

  return { locale, setLocale, t, displayBuiltIn }
}

export type I18nContext = ReturnType<typeof createI18n>
export const i18nKey: InjectionKey<I18nContext> = Symbol('unitale-i18n')

export function useI18n(): I18nContext {
  const i18n = inject(i18nKey)
  if (!i18n) throw new Error('Unitale i18n is unavailable')
  return i18n
}
