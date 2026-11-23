import { readFileSync } from 'node:fs'

const editor = readFileSync(new URL('../src/plan-settings/custom-balance.js', import.meta.url), 'utf8')

export function withCustomBalanceEditor(source) {
  const quota = readFileSync(new URL('../src/plan-settings/quota-section.js', import.meta.url), 'utf8')
  const begin = source.indexOf('    function QuotasSection(props)')
  const endQuota = source.indexOf('    // ── Token 用量统计', begin)
  if (begin < 0 || endQuota < 0) throw new Error('Quota section wrapper not found')
  source = source.slice(0, begin) + quota.replaceAll('el(QuotaSettingsCard,', 'el(PlanQuotaCard,') + source.slice(endQuota)
  const start = source.indexOf('    function CustomBalanceEntryPanel(props)')
  const end = source.indexOf('    function GoQuotaSettings', start)
  if (start < 0 || end < start) throw new Error('Custom balance editor wrapper not found')
  return source.slice(0, start) + editor + source.slice(end)
}
