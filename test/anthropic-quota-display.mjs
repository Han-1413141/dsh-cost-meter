/**
 * Anthropic 额度窗口展示:iguana_necktie(Fable 7 天窗口的内部字段名)不进入窗口表,
 * 避免套餐无 Fable 额度时恒为 100% 把整张卡片染红;主窗口及其百分比保持原样。
 * 客户端的 5h / 7d 标签、80/95 阈值与重置/预测行已写入构建产物,这里核对源码与产物一致。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
console.log('anthropic-quota-display: ok')
