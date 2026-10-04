// Lossless packing must preserve the emitted runtime dictionaries, not just source.
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync, readdirSync } from 'node:fs'
const dir = new URL('../src/client/', import.meta.url)
const source = readdirSync(dir).filter(name => name.endsWith('.js')).sort()
  .map(name => readFileSync(new URL(name, dir), 'utf8')).join('')
const runtime = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const dictionary = runtime.match(/([A-Za-z_$][\w$]*)=Object\.fromEntries\(\[\["zh",/)
assert.ok(dictionary, 'locate generated dictionaries')
function readMessages(code) {
  let factory
  vm.runInNewContext(code, {
    window: { __ModuleLoader__: { load: value => { factory = value.factory } } },
    document: { querySelector: () => ({}) }, navigator: { language: 'en' },
  })
  return JSON.parse(JSON.stringify(factory(() => ({})).__messages))
}
const original = readMessages(source.replace('exports.apply = apply', 'exports.__messages = MESSAGES; exports.apply = apply'))
const emitted = readMessages(runtime.replace(/return ([A-Za-z_$][\w$]*)\.apply=/,
  (_, exports) => `return ${exports}.__messages=${dictionary[1]},${exports}.apply=`))
assert.deepEqual(emitted, original, 'every locale/key/value in emitted bundle must match readable source')
console.log('[ok] lossless client dictionaries:', Object.keys(original.zh).length, 'zh +', Object.keys(original.en).length, 'en translations')
