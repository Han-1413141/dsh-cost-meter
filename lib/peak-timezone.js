/** Display timezone only. Provider calendars and billed timestamps stay absolute. */
export function validPeakTimeZone(value) {
  if (value === 'auto') return true
  if (typeof value !== 'string' || !value || value.length > 100 || /^[+-]/.test(value)) return false
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false }
}
export function peakTimeZone(config) {
  if (config?.peakTimeZone !== 'auto' && validPeakTimeZone(config?.peakTimeZone)) return config.peakTimeZone
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' }
}
export function peakTimeZoneOptions(config) {
  let zones = []
  try { zones = Intl.supportedValuesOf('timeZone') } catch {}
  return [...new Set(['UTC', peakTimeZone({}), peakTimeZone(config), 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Kolkata', 'Asia/Kathmandu',
    'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', ...zones])].sort()
}
export function peakWindowText(windows, config, locale, now) {
  const date = new Date(now), midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  const format = new Intl.DateTimeFormat(locale, { timeZone: peakTimeZone(config), weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return (windows ?? []).map(w => format.format(midnight + w.start * 3600000) + '–'
    + format.format(midnight + (w.end <= w.start ? w.end + 24 : w.end) * 3600000)).join(', ')
}
