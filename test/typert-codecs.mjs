import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { TYPERT } from '../lib/typert.host.js'

// Capture what the shipped (minified) client actually mounts, before UI activation.
// No source rewriting: this also catches a forgotten client rebuild.
let factory, contribution
vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: module => { factory = module.factory } } },
  navigator: { language: 'en' },
})
const client = factory(() => ({}))
const captured = new Error('contribution captured')
await assert.rejects(client.apply({ remote: { $mount: async value => { contribution = value; throw captured } } }), error => error === captured)
let chunkFactory
vm.runInNewContext(readFileSync(new URL('../lib/client.statistics.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: module => { chunkFactory = module.factory } } },
})
const statistics = chunkFactory(() => ({}))
let lazyContribution
await assert.rejects(statistics.mount({ get: () => ({ $mount: async value => { lazyContribution = value; throw captured } }) }), error => error === captured)
contribution.descriptors.push(...lazyContribution.descriptors)
export const CLIENT_CONTRIBUTION = contribution

for (const [face, descriptors] of [['host', TYPERT.invocations], ['client', contribution.descriptors]]) {
  assert.ok(descriptors.length > 0)
  for (const descriptor of descriptors) {
    for (const codec of [descriptor.result, ...descriptor.parameters.map(parameter => parameter.codec)]) {
      assert.equal(codec.mode, 'strict', `${face}/${descriptor.method}`)
      assert.ok(codec.typeSymbol.startsWith('dsh-cost-meter#'))
      assert.equal(typeof codec.create, 'function', `${face}/${descriptor.method} needs create()`)
      assert.equal(codec.create(), codec.schema, 'both host generations use the same parser')
      assert.equal(typeof codec.create().parse, 'function')
    }
  }
  const index = descriptors.find(item => item.method === 'refreshCustomBalance').parameters[0]
  assert.equal(index.acceptsUndefined, true)
  assert.equal(index.codec.create().parse(0), 0)
  assert.equal(index.codec.create().parse(7), 7)
  for (const invalid of [-1, 8, 0.5, '0']) assert.throws(() => index.codec.create().parse(invalid))
  const fetchResult = descriptors.find(item => item.method === 'fetchPrices').result.create()
  assert.equal(fetchResult.parse({ ok: true, message: 'fixture' }).message, 'fixture')
  assert.throws(() => fetchResult.parse(null))
}
const shape = descriptors => Array.from(descriptors, item => [item.id, Array.from(item.parameters, p => [p.wire, p.acceptsUndefined ?? false])]).sort((a, b) => a[0].localeCompare(b[0]))
assert.deepEqual(shape(contribution.descriptors), shape(TYPERT.invocations))
for (const descriptors of [contribution.descriptors, TYPERT.invocations]) {
  const descriptor = descriptors.find(item => item.method === 'getTurnCost')
  const codec = descriptor.result.create()
  const row = { provider: 'test', model: 'm', bucket: 'input', tokens: 100, rate: 1, cost: 0.0001, priced: true, plan: false }
  const call = { kind: 'model', provider: 'test', model: 'm', atMs: 1800000000000, cost: 0.0001, apiCost: 0.0001, plan: false, priced: true, longContext: false, rows: [row] }
  const value = { found: true, cost: 0.0001, apiCost: 0.0001, rows: [row], calls: [call] }
  assert.equal(codec.parse(value).calls[0].rows[0].tokens, 100)
  assert.throws(() => codec.parse({ ...value, calls: [{ ...call, atMs: 'invalid' }] }))
  assert.throws(() => descriptor.parameters[1].codec.create().parse(-1))
}

// Explicit host paths (including CI) must resolve and validate, never silently skip.
const req = createRequire(import.meta.url)
let loader
if (process.env.DSH_TEST_NODE_MODULES) {
  loader = req.resolve('@deepseek-ai/dsh-typert-loader', { paths: [resolve(process.env.DSH_TEST_NODE_MODULES)] })
} else {
  try { loader = req.resolve('@deepseek-ai/dsh-typert-loader') }
  catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error }
}
if (loader) {
  const { validateTypertManifest } = await import(pathToFileURL(loader).href)
  assert.ok(validateTypertManifest('dsh-cost-meter', TYPERT))
  const broken = { ...TYPERT, invocations: TYPERT.invocations.map(item => ({ ...item, result: { ...item.result, mode: 'src-json' } })) }
  assert.throws(() => validateTypertManifest('dsh-cost-meter', broken), /strict codec/)
  console.log('[ok] 安装的真实宿主 loader 接受双入口 codec，拒绝无效清单')
} else {
  console.log('[skip] 未安装宿主 loader；设置 DSH_TEST_NODE_MODULES 可运行真实宿主校验')
}
console.log('[ok] Host 与已构建 Client 的全部 codec 支持 schema/create，参数及结果校验保留')
