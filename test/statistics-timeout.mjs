import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const timers = new Set()
const clock = {
  setTimeout: (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn() }, ms === 15000 ? 5 : ms); timers.add(id); return id },
  clearTimeout: id => { clearTimeout(id); timers.delete(id) },
}
let factory
vm.runInNewContext(readFileSync(new URL('../src/statistics/index.js', import.meta.url), 'utf8').replace('return { mount, prefetchStatistics', 'return { readRequest, requestWithDeadline, mount, prefetchStatistics'), {
  ...clock, window: { __ModuleLoader__: { load: module => { factory = module.factory } } },
})
const ui = factory(() => ({}))
let resolveLate, calls = 0
const api = { timeoutMessage: () => '读取费用记录超时，请刷新重试。', getSessionBilling: () => ++calls === 1 ? new Promise(resolve => { resolveLate = resolve }) : Promise.resolve({ totalCalls: 42 }) }
const query = { sessionId: 'fixture' }
const first = ui.readRequest(api, 'getSessionBilling', query, 'r1')
assert.equal(ui.readRequest(api, 'getSessionBilling', query, 'r1'), first, 'pending reads are shared')
await assert.rejects(first, /读取费用记录超时/)
assert.equal((await ui.readRequest(api, 'getSessionBilling', query, 'r1')).totalCalls, 42, 'retry replaces timed-out request')
resolveLate({ totalCalls: 1 }); await Promise.resolve()
assert.equal((await ui.readRequest(api, 'getSessionBilling', query, 'r1')).totalCalls, 42, 'late result cannot overwrite retry')
assert.equal(calls, 2)

let completeMount, unmounts = 0
await assert.rejects(ui.mount({ get: () => ({ $mount: () => new Promise(resolve => { completeMount = resolve }) }) }, () => 'en'), /timed out/)
completeMount(() => { unmounts++ }); await Promise.resolve(); await Promise.resolve()
assert.equal(unmounts, 1, 'late contribution mount is cleaned up')

const main = readFileSync(new URL('../src/client/03-settings-panels-main.js', import.meta.url), 'utf8')
const start = main.indexOf('    function loadWithDeadline('), end = main.indexOf('\n    }', start) + 6
const context = vm.createContext(clock)
vm.runInContext(main.slice(start, end), context)
await assert.rejects(context.loadWithDeadline(() => new Promise(() => {}), 'retry page'), /retry page/)
assert.equal(await context.loadWithDeadline(() => Promise.resolve('page'), 'retry page'), 'page')
assert.equal(timers.size, 0, 'settled operations leave no deadline timers')
console.log('[ok] Statistics loading: deadlines, retry, cache deduplication, stale-response isolation and late mount cleanup')
