// Mirrored in src/client/02-validators-helpers-sidebar.js for the host's non-ESM client.
export const peakScheduleKeys = ['peakWindows', 'peakHolidays', 'peakSchedule']
export function peakScheduleSettings(value) {
  return Object.fromEntries(peakScheduleKeys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]))
}
export function validPeakSchedule(value) {
  if (!value || typeof value !== 'object') return false
  if (value.peakWindows !== undefined && (!Array.isArray(value.peakWindows) || value.peakWindows.length > 24 || value.peakWindows.some(w => !w || !Number.isFinite(w.start) || !Number.isFinite(w.end) || w.start < 0 || w.start >= 24 || w.end < 0 || w.end > 24 || w.start === w.end))) return false
  if (value.peakSchedule !== undefined && !['deepseek', 'volcengine', 'ollama', 'daily', 'utc-weekdays'].includes(value.peakSchedule)) return false
  if (value.peakHolidays !== undefined && value.peakHolidays !== null && (!Array.isArray(value.peakHolidays) || value.peakHolidays.length > 366 || value.peakHolidays.some(day => typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day + 'T00:00:00Z')) || new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day))) return false
  return true
}
export function withProviderPeakSchedule(result, provider, prices) {
  if (!result?.entry) return result
  const table = prices?.providers?.[provider] ?? (['deepseek-official', 'deepseek-account', ''].includes(provider) ? prices?.providers?.deepseek : undefined)
  const entry = { ...peakScheduleSettings(table), ...result.entry }
  return { ...result, entry, billingMode: (entry.peak || entry.offPeak) && Object.keys(peakScheduleSettings(entry)).length && entry.billingMode !== 'flat' ? 'deepseek-peak' : result.billingMode }
}
export function configuredPeakAt(entry, atMs, peak) {
  const explicit = entry.peakWindows !== undefined || entry.peakHolidays !== undefined || ['daily', 'utc-weekdays', 'deepseek'].includes(entry.peakSchedule)
  if (!explicit) return null
  if (peak?.enabled !== true || !Number.isFinite(atMs) || (Number.isFinite(peak.effectiveAtMs) && atMs < peak.effectiveAtMs)) return 'base'
  const schedule = entry.peakSchedule ?? (entry.billingMode === 'utc-peak' ? 'utc-weekdays' : 'deepseek')
  const windows = entry.peakWindows ?? (schedule === 'ollama' ? [{ start: 12, end: 18 }] : peak.windows ?? [])
  const holidays = entry.peakHolidays === null ? [] : entry.peakHolidays ?? (['ollama', 'volcengine', 'utc-weekdays', 'daily'].includes(schedule) ? [] : peak.holidays ?? [])
  const local = new Date(atMs + 8 * 3600000), utc = new Date(atMs)
  const day = ['ollama', 'utc-weekdays'].includes(schedule) ? utc.getUTCDay() : local.getUTCDay()
  if ((schedule !== 'daily' && (day === 0 || day === 6)) || holidays.includes(local.toISOString().slice(0, 10))) return 'offPeak'
  const hour = utc.getUTCHours() + utc.getUTCMinutes() / 60 + utc.getUTCSeconds() / 3600 + utc.getUTCMilliseconds() / 3600000
  return windows.some(w => w.start < w.end ? hour >= w.start && hour < w.end : hour >= w.start || hour < w.end) ? 'peak' : 'offPeak'
}

export function configuredPeakPhase(entry, atMs, peak) {
  const phase = configuredPeakAt(entry, atMs, peak)
  if (phase === null || phase === 'base') return null
  const windows = entry.peakWindows ?? (entry.peakSchedule === 'ollama' ? [{ start: 12, end: 18 }] : peak.windows ?? [])
  const midnight = Math.floor(atMs / 86400000) * 86400000, candidates = new Set()
  const span = Math.max(9, Math.min(380, (entry.peakHolidays ?? peak.holidays ?? []).length + 8))
  for (let day = -span; day <= span; day++) {
    const start = midnight + day * 86400000
    for (const hour of [0, 16, ...windows.flatMap(w => [w.start, w.end])]) candidates.add(start + hour * 3600000)
  }
  let previous = null, next = null
  for (const time of candidates) {
    if (configuredPeakAt(entry, time - 1, peak) === configuredPeakAt(entry, time, peak)) continue
    if (time <= atMs && (previous === null || time > previous)) previous = time
    if (time > atMs && (next === null || time < next)) next = time
  }
  if (previous === null || next === null) return null
  return { inPeak: phase === 'peak', weekend: false, prevAtMs: previous, nextAtMs: next, nextIntoPeak: configuredPeakAt(entry, next, peak) === 'peak' }
}
