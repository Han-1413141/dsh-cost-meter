import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import vm from 'node:vm'
import { sanitizeConfig } from '../lib/store.js'

const directory = new URL('../src/client/', import.meta.url)
const source = readdirSync(directory).filter(name => name.endsWith('.js')).sort().map(name => readFileSync(new URL(name, directory), 'utf8')).join('')
let factory, stateIndex = 0
const row = { provider: 'deepseek-official', model: 'deepseek-v4-flash', bucket: 'input', tokens: 100, rate: 1, cost: .0001, priced: true, plan: false }
const value = { found: true, cost: .0001, apiCost: .0001, rows: [row], calls: [{ ...row, kind: 'search', atMs: 1792341000000, rows: [row] }] }
const original = JSON.stringify(value)
const el = (type, props, ...children) => ({ type, props: props ?? {}, children })
vm.runInNewContext(source.replace('exports.apply = apply', 'exports.test = { prettyProviderKey, TurnCost }; exports.apply = apply'), {
  navigator: { language: 'zh' }, window: { __ModuleLoader__: { load: module => { factory = module.factory } } },
})
const ui = factory(name => name === 'react' ? { createElement: el, Fragment: 'fragment', useEffect() {}, useRef: () => ({ current: null }), useState: () => [stateIndex++ === 0 ? value : '', () => {}] } : {}).test
const stats = readFileSync(new URL('../src/statistics/index.js', import.meta.url), 'utf8')
const modelLabels = () => ({ 'qoder-global:dfmodel': 'Qoder Global:DeepSeek-Flash' })
const statisticsLabel = vm.runInNewContext(stats.match(/const prettyProviderKey = [^\n]+/)[0] + '\nprettyProviderKey', { modelLabels })
assert.equal(statisticsLabel('qoder-global:dfmodel'), 'Qoder Global:DeepSeek-Flash')
for (const provider of ['deepseek', 'deepseek-official', 'deepseek-account']) for (const model of ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v4.1-flash']) {
  const key = provider + ':' + model
  assert.equal(ui.prettyProviderKey(key), provider + ':DeepSeek V4.1 Flash')
  assert.equal(statisticsLabel(key), ui.prettyProviderKey(key), 'lazy detail and sidebar labels agree')
}
for (const key of ['openrouter:deepseek/deepseek-v4-flash', 'custom:deepseek-v4-flash', 'deepseek-official:deepseek-v4-pro']) assert.equal(ui.prettyProviderKey(key), key, 'third-party and other official models retain their names')
assert.equal(ui.prettyProviderKey('zen:model'), 'go:model')
const tree = ui.TurnCost({ useCost: () => ({ state: { config: sanitizeConfig({ locale: 'zh' }) } }), turn: { start: { seq: 1 }, end: { seq: 5 } }, sessionId: 'fixture' })
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.children) : node == null ? '' : String(node)
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' ? [node, ...nodes(node.children)] : []
assert.ok(text(tree).includes('原生搜索 · deepseek-official:DeepSeek V4.1 Flash'))
assert.ok(!text(tree).includes('deepseek-v4-flash'))
assert.ok(nodes(tree).some(node => node.props.title === 'deepseek-official:deepseek-v4-flash'), 'original ID remains available in the call tooltip')
assert.equal(JSON.stringify(value), original, 'display normalization never changes recorded IDs or money')
console.log('[ok] official Flash display labels: sidebar/detail parity, native search, raw ID tooltip, third-party isolation and unchanged recorded money')
