import {
  HOST_SETTINGS_CACHE_MAX_AGE_MS,
  readHostLocaleSetting,
  invalidateHostLocaleCache,
  forgetHostSettings,
} from './host-settings.js'

/** The browser locale face is optional; Host DSH exposes its saved preference through settings. */
export const HOST_LOCALE_MAX_AGE_MS = HOST_SETTINGS_CACHE_MAX_AGE_MS

/** describe() may itself emit settings/document-updated; do not recursively describe again. */
export function invalidateHostLocale(ctx) {
  return invalidateHostLocaleCache(ctx)
}

export function forgetHostLocale(ctx) { forgetHostSettings(ctx) }

export function supportedLocale(value) {
  if (typeof value !== 'string') return null
  const language = value.trim().toLowerCase().split(/[-_]/)[0]
  return language === 'zh' || language === 'en' ? language : null
}

export function hostLocaleOf(ctx) {
  try {
    const locale = ctx?.get?.('locale')
    const active = supportedLocale(locale?.getSnapshot?.().active)
    if (active) return active
  } catch { /* Older hosts have no locale face. */ }
  return readHostLocaleSetting(ctx, HOST_LOCALE_MAX_AGE_MS)
}

export function localeOf(config, ctx) {
  if (config?.locale === 'zh' || config?.locale === 'en') return config.locale
  // An unset preference/native bootstrap can be browser-local. Host cannot infer it.
  return hostLocaleOf(ctx) ?? 'zh'
}
