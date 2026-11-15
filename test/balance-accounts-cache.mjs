import assert from 'node:assert/strict'
import { createBalanceAccounts } from '../lib/balance-accounts.js'

const empty = () => ({ status: 'off', message: '', fetchedAt: 0, currency: '', totalBalance: 0, grantedBalance: 0, toppedUpBalance: 0 })
const value = amount => ({ currency: 'USD', totalBalance: amount, grantedBalance: 0, toppedUpBalance: amount })
const cache = createBalanceAccounts()
let release, entered, oldSignal
const gate = new Promise(done => { release = done }), started = new Promise(done => { entered = done })
const options = { empty, interval: 60000, selected: () => ({ ...empty(), ...value(10), status: 'ok' }) }
const previous = cache.refresh({ ...options, prepare: async () => [{ id: 'old', label: 'Old', identity: 'old-key' }], query: async (_, signal) => { oldSignal = signal; entered(); await gate; return value(999) } })
await started
cache.reset()
assert.equal(oldSignal.aborted, true)
await cache.refresh({ ...options, prepare: async () => [{ id: 'new', label: 'New', identity: 'new-key' }], query: async () => value(20) })
release(); await previous
assert.equal(cache.snapshot()[0].id, 'new')
assert.equal(cache.snapshot()[0].totalBalance, 20, 'a removed account cannot publish a late balance')

cache.reset()
const calls = new Map()
const accounts = [{ id: 'limited', label: 'Limited', identity: 'limited' }, { id: 'ready', label: 'Ready', identity: 'ready' }]
const query = async account => {
  calls.set(account.id, (calls.get(account.id) ?? 0) + 1)
  if (account.id === 'limited') throw Object.assign(Error('Rate limited'), { balanceRetry: true, balanceRateLimited: true })
  return value(30)
}
await cache.refresh({ ...options, prepare: async () => accounts, query })
await cache.refresh({ ...options, prepare: async () => accounts, query, force: true })
assert.equal(calls.get('limited'), 1, 'rate limits apply independently to each account')
assert.equal(calls.get('ready'), 2)
assert.equal(cache.snapshot().find(row => row.id === 'ready').status, 'ok')
cache.reset()
console.log('[ok] balance accounts: cancellation, late responses and independent rate limits')
