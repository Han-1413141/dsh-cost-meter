import { readFileSync } from 'node:fs'

const editor = readFileSync(new URL('../src/plan-settings/custom-balance.js', import.meta.url), 'utf8')

export function withCustomBalanceEditor(source) {
  const start = source.indexOf('    function CustomBalanceEntryPanel(props)')
  const end = source.indexOf('    function GoQuotaSettings', start)
  if (start < 0 || end < start) throw new Error('Custom balance editor wrapper not found')
  return source.slice(0, start) + editor + source.slice(end)
}
