import assert from 'node:assert/strict'
import { createNativeSearchBilling } from '../lib/native-search-billing.js'
const endpoint = 'https://api.deepseek.com/anthropic/v1/messages'
const payload = { model: 'deepseek-v4-flash', usage: { input_tokens: 20, output_tokens: 3 } }
const accounts = [], misses = [], counters = {}, listeners = new Map()
const diagnostics = name => ({ subscribe: fn => listeners.set(name, fn), unsubscribe: () => listeners.delete(name) })
let parsed = payload, diagnostic = false, failure, returnedPromise, returnedJson
const target = { fetch(url, options) {
  assert.equal(this, target)
  if (failure) return returnedPromise = Promise.reject(failure)
  if (diagnostic) {
    const request = { method: 'POST', origin: 'https://api.deepseek.com', path: '/anthropic/v1/messages' }
    const publish = (name, values) => listeners.get('undici:request:' + name)?.({ request, ...values })
    publish('create'); publish('headers', { response: { statusCode: 200, headers: [] } })
    publish('bodyChunkReceived', { chunk: Buffer.from(JSON.stringify(payload)) }); publish('trailers')
  }
  const response = { ok: true, json() { assert.equal(this, response); return returnedJson = Promise.resolve(parsed) } }
  return returnedPromise = Promise.resolve(response)
} }
const original = target.fetch
const monitor = createNativeSearchBilling({ account: (event, session) => accounts.push({ event, session }), uncovered: e => misses.push(e), diagnostics, fetchTarget: target, diagnose: name => counters[name] = (counters[name] ?? 0) + 1 })
const options = { method: 'POST', get headers() { throw new Error('must not read credentials') }, get body() { throw new Error('must not read query') } }
const search = id => monitor.run(async () => {
  const promise = target.fetch(endpoint, options)
  assert.equal(promise, returnedPromise, 'fetch promise identity is preserved')
  const response = await promise, json = response.json()
  assert.equal(json, returnedJson, 'json promise identity is preserved')
  assert.equal(await json, parsed, 'the provider receives the original payload object')
}, { id })
try {
  await Promise.all([search('a'), search('b')])
  assert.deepEqual(accounts.map(row => row.session.id).sort(), ['a', 'b'])
  diagnostic = true; await search('both')
  assert.equal(accounts.length, 3, 'diagnostic and fetch observations account once')
  diagnostic = false
  await target.fetch(endpoint, options).then(r => r.json())
  await monitor.run(() => target.fetch('https://example.test/messages', options).then(r => r.json()), { id: 'other' })
  assert.equal(accounts.length, 3, 'ordinary and non-official fetch calls are ignored')
  parsed = {}; await search('missing'); assert.equal(misses.length, 1)
  parsed = payload
  const boom = new Error('original abort')
  failure = boom
  await assert.rejects(search('failed'), error => error === boom)
  failure = undefined
  // A child task retaining an old AsyncLocalStorage scope cannot bill future ordinary calls.
  let release, late
  await monitor.run(() => { late = new Promise(resolve => { release = resolve }).then(() => target.fetch(endpoint, options).then(r => r.json())) }, { id: 'closed' })
  release(); await late
  assert.equal(accounts.length, 3)
  assert.equal(counters.fetchRequest, 5)
} finally { monitor.dispose() }
assert.equal(target.fetch, original)
assert.equal(listeners.size, 0)
console.log('[ok] parsed search response: transport fallback, concurrent sessions, exact-once accounting, unchanged promises/errors, scope/endpoint isolation and unload')
