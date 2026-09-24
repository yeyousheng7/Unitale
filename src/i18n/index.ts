import { inject, ref, watch, type InjectionKey } from 'vue'
import { enUS } from './messages/en-US'
import { zhCN, type MessageKey } from './messages/zh-CN'

export type Locale = 'zh-CN' | 'en-US'
type TranslationParams = Record<string, string | number>

const messages: Record<Locale, Partial<Record<MessageKey, string>>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
}

export function resolveLocale(language: string): Locale {
  return language.toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN'
}

function formatMessage(key: MessageKey, locale: Locale, params?: TranslationParams): string {
  const value = messages[locale][key] ?? zhCN[key]
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

  return { locale, setLocale, t }
}

export type I18nContext = ReturnType<typeof createI18n>
export const i18nKey: InjectionKey<I18nContext> = Symbol('unitale-i18n')

export function useI18n(): I18nContext {
  const i18n = inject(i18nKey)
  if (!i18n) throw new Error('Unitale i18n is unavailable')
  return i18n
}
