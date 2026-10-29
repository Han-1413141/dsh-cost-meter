/**
 * Anthropic 额度窗口展示:iguana_necktie(Fable 7 天窗口的内部字段名)不进入窗口表,
 * 避免套餐无 Fable 额度时恒为 100% 把整张卡片染红;主窗口及其百分比保持原样。
 * 客户端的 5h / 7d 标签、80/95 阈值与重置/预测行已写入构建产物,这里核对源码与产物一致。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { parseAnthropicUsage } from '../lib/coding-plans.js'

const windows = parseAnthropicUsage({
  five_hour: { utilization: 43, resets_at: 1893456000 },
  seven_day: { utilization: 57, resets_at: 1893456000 },
  iguana_necktie: { utilization: 100, resets_at: 1893456000 },
})
assert.deepEqual(Object.keys(windows), ['five_hour', 'seven_day'], 'iguana_necktie 不展示')
assert.equal(windows.five_hour.percent, 43)
assert.equal(windows.seven_day.percent, 57)
assert.equal(parseAnthropicUsage({ iguana_necktie: { utilization: 100 } }), null, '只剩 iguana 时视为无窗口')

const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
for (const key of ['quotaResetInHm', 'quotaResetInM', 'quotaResetAt', 'quotaForecastHit', 'cm-mm-sub']) {
  assert.ok(client.includes(key), `构建产物包含 ${key}`)
}
const source = readFileSync(new URL('../src/client/02-validators-helpers-sidebar.js', import.meta.url), 'utf8')
const context = vm.createContext({})
for (const name of ['quotaWindowHours', 'quotaResetLines', 'codingPlanQuotaLevel']) {
  const start = source.indexOf('    function ' + name + '(')
  assert.ok(start >= 0)
  vm.runInContext(source.slice(start, source.indexOf('\n    }', start) + 6), context)
}
const now = Date.parse('2026-10-29T08:00:00Z')
const t = (key, args) => key + ':' + JSON.stringify(args)
const lines = (percent, leftHours, name = 'five_hour') => context.quotaResetLines(name, { percent, resetsAt: new Date(now + leftHours * 3600000).toISOString() }, t, 'en', now)
assert.equal(lines(46, 1.5).forecast, '', 'moderate usage does not forecast exhaustion')
assert.ok(lines(84, 3).forecast.startsWith('quotaForecastHit:'))
assert.ok(lines(80, 96, 'seven_day').forecast.startsWith('quotaForecastHit:'))
for (const percent of [0, 100, 120]) assert.equal(lines(percent, 3).forecast, '', 'no past exhaustion forecast')
assert.equal(lines(30, 4.9).forecast, '', 'less than 10% of window elapsed')
assert.equal(lines(43, -1), null, 'expired window has no reset countdown')
assert.equal(lines(NaN, 3), null)
assert.equal(lines(43, 3).reset, 'quotaResetInHm:{"h":3,"m":0}')
for (const [percent, expected] of [[43, 'ok'], [80, 'warn'], [94, 'warn'], [95, 'over']]) assert.equal(context.codingPlanQuotaLevel(percent, 'anthropic'), expected)
assert.equal(context.codingPlanQuotaLevel(95, 'opendesign'), 'warn', 'other providers retain their threshold')
console.log('anthropic-quota-display: ok')
