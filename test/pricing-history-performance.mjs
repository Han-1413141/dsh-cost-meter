import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Ledger, sanitizeConfig } from '../lib/store.js'
import { createPricingHistory, advancePricingHistory, normalizePricingHistory, encodePricingHistory,
  copyPricingHistory, mergePricingHistory, bindPricingHistory, pricingConfigAt, recordPricingRevision } from '../lib/billing-history.js'
import { withLedgerLock } from '../lib/ledger-persistence.js'

const root = mkdtempSync(join(tmpdir(), 'cm-price-history-performance-'))
const path = join(root, 'ledger.json'), at = Date.parse('2026-10-15T00:00:00Z')
const config = sanitizeConfig({ prices: { providers: { fixture: { models: { model: { cacheMiss: 1, cacheHit: .1, output: 2 } } } } } })
const history = createPricingHistory(config), expected = [structuredClone(history.versions[history.changes.initial.version])]
const nativeClone = globalThis.structuredClone
let ledger, peer, wholeClones = 0
try {
  // Distinct catalogs, not repeated duplicate fixtures: add/remove models and tiers too.
  for (let i = 1; i < 152; i++) {
    config.prices.providers.fixture.models.model.cacheMiss = i + 1
    config.prices.providers.fixture.models.model.longContext = [{ aboveInputTokens: 1000, cacheMiss: i + 2, output: i + 3 }]
    if (i % 2) config.prices.providers.fixture.models.temporary = { cacheMiss: i, output: i }
    else delete config.prices.providers.fixture.models.temporary
    advancePricingHistory(history, config, at + i * 1000)
    expected.push(structuredClone(history.versions[Object.values(history.changes).at(-1).version]))
  }
  recordPricingRevision(history, config, 'revised', '2026-10-15', at + 200000, { cost: .0123 }, { cost: .0456 })
  const legacy = JSON.stringify({ version: 1, config, days: {}, pricingHistory: history })
  writeFileSync(path, legacy)
  const cliPath = join(root, 'offline.json')
  writeFileSync(cliPath, legacy)
  const cli = args => spawnSync(process.execPath, [fileURLToPath(new URL('../lib/compact-pricing-history-cli.js', import.meta.url)), '--ledger', cliPath, ...args], { encoding: 'utf8' })
  const preview = cli([])
  assert.equal(preview.status, 0, preview.stderr)
  assert.equal(JSON.parse(preview.stdout).written, false)
  assert.equal(readFileSync(cliPath, 'utf8'), legacy)
  const applied = cli(['--apply'])
  assert.equal(applied.status, 0, applied.stderr)
  assert.equal(JSON.parse(applied.stdout).written, true)
  assert.equal(readFileSync(`${cliPath}.pricing-history-v1.bak`, 'utf8'), legacy)
  assert.deepEqual(normalizePricingHistory(JSON.parse(readFileSync(cliPath, 'utf8')).pricingHistory, config), history)
  const compact = JSON.stringify(encodePricingHistory(history))
  assert.ok(compact.length < JSON.stringify(history).length * .2, 'catalog changes are stored as bounded deltas')
  const disk = JSON.parse(compact), versions = disk.versions
  for (const id of Object.keys(versions)) {
    let cursor = id, depth = 0
    while (versions[cursor].base) { cursor = versions[cursor].base; assert.ok(++depth <= 24, 'periodic checkpoints bound replay') }
  }
  const restored = normalizePricingHistory(disk, config)
  const ids = Object.keys(restored.versions)
  assert.equal(restored.versions[ids[0]].prices.models, restored.versions[ids[1]].prices.models,
    'unchanged model catalogs share one sanitized immutable tree across delta versions')
  assert.deepEqual(restored, history, 'all versions, timelines, FX and original/recalculated amounts round-trip')
  const bound = bindPricingHistory({ ...config }, restored)
  for (let i = 0; i < expected.length; i++) {
    const value = pricingConfigAt(bound, at + i * 1000)
    assert.deepEqual(value.prices, expected[i].prices, `exact historical catalog at change ${i}`)
    const id = Object.values(history.changes)[i].version
    assert.ok(Object.isFrozen(restored.versions[id].prices.providers.fixture.models.model))
  }
  const copy = copyPricingHistory(restored)
  copy.revisions[Object.keys(copy.revisions)[0]].before.cost = 9
  assert.equal(Object.values(restored.revisions)[0].before.cost, .0123, 'amount records remain detached')

  // Cache works both before and after legacy conversion, and never trusts an altered record.
  const loadedLegacy = normalizePricingHistory(JSON.parse(legacy).pricingHistory, config)
  const cachedLegacy = normalizePricingHistory(JSON.parse(legacy).pricingHistory, config, loadedLegacy)
  for (const id of Object.keys(loadedLegacy.versions)) assert.equal(cachedLegacy.versions[id], loadedLegacy.versions[id])
  const cached = normalizePricingHistory(JSON.parse(JSON.stringify(encodePricingHistory(cachedLegacy))), config, cachedLegacy)
  for (const id of Object.keys(cached.versions)) assert.equal(cached.versions[id], cachedLegacy.versions[id])
  const changed = JSON.parse(JSON.stringify(encodePricingHistory(cached)))
  const initialId = changed.changes.initial.version
  changed.versions[initialId].prices.providers.fixture.models.model.output = 987
  assert.notEqual(normalizePricingHistory(changed, config, cached).versions[initialId], cached.versions[initialId])
  assert.equal(cached.versions[initialId].prices.providers.fixture.models.model.output, 2)

  // Reject damaged/malicious deltas without poisoning Object.prototype or valid history.
  const malformed = JSON.parse(compact), badId = 'f'.repeat(64)
  for (const record of [
    { base: badId, patch: [] },
    { base: 'e'.repeat(64), patch: [] },
    { base: initialId, patch: [[['prices', '__proto__', 'polluted'], true]] },
    { base: initialId, patch: [[['prices'], null]] },
  ]) {
    malformed.versions[badId] = record
    const valid = normalizePricingHistory(malformed, config)
    assert.ok(!Object.hasOwn(valid.versions, badId))
    assert.equal(Object.keys(valid.versions).length, 152)
  }
  assert.equal({}.polluted, undefined)

  globalThis.structuredClone = (value, ...args) => {
    if (value?.pricingHistory || value?.versions) wholeClones++
    return nativeClone(value, ...args)
  }
  ledger = Ledger.load(path)
  assert.equal(ledger.pendingWrite, true, 'legacy catalogs schedule their one-time conversion without waiting for a call')
  ledger.flush()
  assert.equal(ledger.pendingWrite, false)
  assert.equal(readFileSync(`${path}.pricing-history-v1.bak`, 'utf8'), legacy, 'migration makes a byte-exact original backup')
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).pricingHistory.format, 2)
  assert.equal(Object.keys(ledger.pricingHistory.versions).length, 152)
  const nativeRead = ledger.readDiskSnapshot.bind(ledger)
  let reads = 0
  ledger.readDiskSnapshot = () => { reads++; return nativeRead() }
  for (let i = 0; i < 10; i++) ledger.refresh()
  assert.equal(reads, 0, 'own atomic write does not cause an echoed read/merge on the next idle tick')

  // Two independently edited price histories merge without cycles or losing original amounts.
  peer = Ledger.load(path)
  const stableId = initialId, stableVersion = ledger.pricingHistory.versions[stableId]
  peer.account({ input: 100, output: 20 }, 'model', 'peer', Date.now(), 'fixture'); peer.flush()
  ledger.refresh()
  assert.equal(ledger.pricingHistory.versions[stableId], stableVersion, 'usage-only peer updates reuse immutable catalogs')
  ledger.config = { ...ledger.config, priceMatch: 'exact' }; ledger.scheduleWrite(); ledger.flush()
  peer.config = { ...peer.config, peakEnabled: false }; peer.scheduleWrite(); peer.flush()
  ledger.refresh()
  const merged = mergePricingHistory(ledger.pricingHistory, peer.pricingHistory)
  const roundTrip = normalizePricingHistory(JSON.parse(JSON.stringify(encodePricingHistory(merged))), config)
  assert.deepEqual(roundTrip, merged)
  assert.equal(Object.values(roundTrip.revisions)[0].before.cost, .0123)

  const messages = [], warn = console.warn, wait = Atomics.wait
  console.warn = message => messages.push(message)
  Atomics.wait = () => assert.fail('ordinary flush must yield instead of waiting on the event loop')
  try {
    withLedgerLock(path, () => {
      ledger.account({ input: 10 }, 'model', 'after-lock', Date.now(), 'fixture')
      ledger.flush()
      assert.equal(ledger.pendingWrite, true, 'busy lock retains pending calls')
    })
    ledger.flush()
    assert.equal(ledger.pendingWrite, false)
  } finally { Atomics.wait = wait; console.warn = warn }
  assert.equal(messages.length, 0, 'expected ordinary lock contention does not flood the host log')
  assert.equal(wholeClones, 0, 'historical catalogs never enter whole-ledger structuredClone')
  assert.equal(readFileSync(`${path}.pricing-history-v1.bak`, 'utf8'), legacy, 'later writes do not replace the original backup')
  console.log('[ok] #297: 152 lossless price versions, bounded deltas, exact migration backup, cached idle/peer refresh, concurrent prices and nonblocking lock retries')
} finally {
  globalThis.structuredClone = nativeClone
  ledger?.close(); peer?.close()
  assert.equal(dirname(resolve(root)), resolve(tmpdir()))
  rmSync(root, { recursive: true, force: true })
}
