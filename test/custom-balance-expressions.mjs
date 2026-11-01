import assert from 'node:assert/strict'
import { extractByRule, balanceExpression } from '../lib/balance-expression.js'
import { queryCustomBalance } from '../lib/custom-balance.js'

const data = { data: { total: '15000000', used: 2500000, subscriptions: [{ total: 80, used: 20 }, { total: 50, used: 10 }] } }
assert.equal(balanceExpression(data, '(data.total - data.used) / 500000'), 25)
assert.equal(balanceExpression(data, 'max(0, data.used / 500000 - 10)'), 0)
assert.equal(balanceExpression(data, 'round(1.55 * 100) / 100 + 2 ** 3'), 9.55)
assert.equal(balanceExpression(data, 'data["subscriptions"][0].total'), 80)
assert.equal(balanceExpression(data, 'data.subscriptions[0].total'), 80)
assert.equal(extractByRule(data, { op: 'divide', args: [{ op: 'subtract', args: ['data.total', 'data.used'] }, 500000] }), 25)
assert.equal(extractByRule(data, { op: 'sum', path: 'data.subscriptions', value: { expression: 'total - used' } }), 100)
assert.equal(extractByRule(data, { op: 'multiply', args: [2, { op: 'max', args: [10, 'data.subscriptions.0.total'] }] }), 160)
assert.equal(extractByRule({ rows: [] }, { op: 'sum', path: 'rows', value: 'remaining' }), 0)
for (const expression of ['data.total / 0', 'data.missing + 1', 'null + 1', 'process.exit()', 'globalThis', 'data.constructor', 'data["__proto__"]', 'Math.max(1,2)', '1; 2', '1 + true', '1e999', '2 ** 10000', 'abs(1,2)', '1 /* ignored */ + 2']) assert.equal(balanceExpression(data, expression), null, expression)
assert.equal(balanceExpression({ missing: false }, 'missing + 1'), null)
assert.equal(extractByRule(data, { op: 'divide', args: [1, 0] }), null)
assert.equal(extractByRule(data, { op: 'add', args: [1, 'missing'] }), null)
let nested = 1
for (let n = 0; n < 30; n++) nested = { op: 'add', args: [nested] }
assert.equal(extractByRule(data, nested), null)
const oldFetch = globalThis.fetch
try {
  globalThis.fetch = async () => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
  const entry = { enabled: true, request: { url: 'https://example.com/balance' }, extract: {
    remaining: { expression: '(data.total - data.used) / 500000' },
    spend: { op: 'divide', path: 'data.used', by: 500000 }, maxBudget: { op: 'divide', path: 'data.total', by: 500000 },
  } }
  const result = await queryCustomBalance({ get: () => undefined }, { customBalance: entry })
  assert.equal(result.remaining, 25)
  assert.equal(result.spend, 5)
  assert.equal(result.maxBudget, 30)
  await assert.rejects(() => queryCustomBalance({ get: () => undefined }, { customBalance: { ...entry, extract: { remaining: { expression: 'data.missing - data.used' } } } }), /missing or not numeric/)
} finally { globalThis.fetch = oldFetch }
console.log('[ok] custom balance expressions: nested arithmetic, subscriptions, unit conversion, invalid values and restricted grammar')
