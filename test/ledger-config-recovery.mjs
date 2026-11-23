import assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Ledger, sanitizeConfig, stripSecrets } from '../lib/store.js'
import { withLedgerLock, writeLedger, writeLedgerConfigBackup, readLedgerConfigBackup } from '../lib/ledger-persistence.js'

const root = fs.mkdtempSync(join(tmpdir(), 'cm-config-recovery-'))
const ledgers = []
const read = path => JSON.parse(fs.readFileSync(path, 'utf8'))
const load = path => {
  const ledger = withLedgerLock(path, () => Ledger.load(path))
  ledgers.push(ledger)
  return ledger
}
const save = ledger => { ledger.scheduleWrite(); ledger.flush(); assert.equal(ledger.pendingWrite, false) }
const fixtureConfig = () => sanitizeConfig({
  locale: 'en', historyDays: 45,
  codingPlans: { minimax: { enabled: true, display: 'settings', apiKey: 'fixture-plan-secret' } },
  customBalances: [{ enabled: true, label: 'Saved balance', display: 'sidebar', refreshMinutes: 17,
    request: { url: 'https://balance.example.test/credits', method: 'GET', headers: {
      Authorization: '{{BALANCE_TOKEN}}', 'X-Api-Key': 'fixture-balance-secret', 'Content-Type': 'application/json',
    } }, extract: { remaining: 'data.remaining' } }],
})

try {
  if (process.argv.includes('--io-faults')) {
    // Run fault injection in a separate process so other fixtures never see patched fs calls.
    const path = join(root, 'ledger.json')
    const state = { version: 1, config: { locale: 'en' }, migrations: [], days: {} }
    writeLedger(path, state)
    const original = fs.readFileSync(path), backup = fs.readFileSync(`${path}.config-bak`)
    const originalSync = fs.fsyncSync, originalRename = fs.renameSync
    let synced = new Set(), failSync = false, failRename = false, replacements = 0
    fs.fsyncSync = fd => {
      if (failSync && fs.fstatSync(fd).isFile()) throw Object.assign(Error('fixture sync failure'), { code: 'EIO' })
      originalSync(fd)
      synced.add(fs.fstatSync(fd).ino)
    }
    fs.renameSync = (from, to) => {
      assert.ok(synced.has(fs.statSync(from).ino), 'replacement file was synced before rename')
      replacements++
      if (failRename) throw Object.assign(Error('fixture rename failure'), { code: 'EPERM' })
      return originalRename(from, to)
    }
    syncBuiltinESMExports()
    try {
      failSync = true
      assert.throws(() => writeLedger(path, { ...state, days: { marker: {} } }), { code: 'EIO' })
      assert.deepEqual(fs.readFileSync(path), original)
      assert.equal(replacements, 0)
      assert.throws(() => writeLedger(path, { ...state, config: { locale: 'zh' } }), { code: 'EIO' })
      assert.deepEqual(fs.readFileSync(`${path}.config-bak`), backup)
      failSync = false; failRename = true
      assert.throws(() => writeLedger(path, { ...state, days: { marker: {} } }), { code: 'EPERM' })
      assert.deepEqual(fs.readFileSync(path), original)
      failRename = false
      writeLedger(path, { ...state, config: { locale: 'zh' } })
      assert.equal(read(path).config.locale, 'zh')
      assert.equal(read(`${path}.config-bak`).config.locale, 'zh')
      assert.ok(!fs.readdirSync(root).some(name => name.endsWith('.tmp')), 'failed writes clean temporary files')
    } finally { fs.fsyncSync = originalSync; fs.renameSync = originalRename; syncBuiltinESMExports() }
  } else {
    const path = join(root, 'ledger.json')
    const ledger = load(path)
    ledger.config = fixtureConfig()
    save(ledger)
    const backupPath = `${path}.config-bak`
    const backup = read(backupPath)
    assert.deepEqual(Object.keys(backup).sort(), ['config', 'migrations', 'version'])
    assert.deepEqual(backup.config, stripSecrets(ledger.config))
    assert.ok(!fs.readFileSync(backupPath, 'utf8').includes('fixture-plan-secret'))
    assert.ok(!fs.readFileSync(backupPath, 'utf8').includes('fixture-balance-secret'))
    assert.equal(backup.config.customBalances[0].request.headers.Authorization, '{{BALANCE_TOKEN}}')
    fs.utimesSync(backupPath, new Date(100000), new Date(100000))
    const backupTime = fs.statSync(backupPath).mtimeMs
    ledger.account({ input: 100, output: 10 }, 'deepseek-v4-flash', 'session', Date.now(), 'deepseek')
    ledger.flush()
    assert.equal(fs.statSync(backupPath).mtimeMs, backupTime, 'usage-only writes do not rewrite config')
    await ledger.close()

    const zeroed = Buffer.alloc(838379)
    fs.writeFileSync(path, zeroed)
    const restored = load(path)
    assert.deepEqual(stripSecrets(restored.config), backup.config)
    assert.equal(restored.config.codingPlans.minimax.display, 'settings', 'saved migration markers prevent applying old defaults again')
    assert.deepEqual(restored.days, {})
    assert.equal(restored.balanceRef, null)
    const quarantined = fs.readdirSync(root).find(name => name.startsWith('ledger.json.corrupt-'))
    assert.ok(quarantined)
    assert.deepEqual(fs.readFileSync(join(root, quarantined)), zeroed)
    restored.flush(); assert.equal(restored.pendingWrite, false)
    await restored.close()

    // A valid ledger is authoritative; a stale backup must not resurrect deleted entries.
    const healthy = read(path)
    healthy.config.customBalances = []
    fs.writeFileSync(path, JSON.stringify(healthy))
    const upgraded = load(path)
    assert.equal(upgraded.config.customBalances.length, 0)
    assert.equal(read(backupPath).config.customBalances.length, 0)
    await upgraded.close()
    fs.unlinkSync(backupPath)
    const seeded = load(path)
    assert.ok(fs.existsSync(backupPath), 'existing healthy installations create a backup on load')
    await seeded.close()

    // Background saves use the same durable writer and the merged configuration.
    const left = load(path), right = load(path)
    left.config.historyDays = 61; left.scheduleWrite()
    right.config.customBalances = fixtureConfig().customBalances; right.scheduleWrite()
    await Promise.all([left.flushAsync(), right.flushAsync()])
    assert.deepEqual(read(backupPath).config, read(path).config)
    assert.equal(read(backupPath).config.historyDays, 61)
    assert.equal(read(backupPath).config.customBalances.length, 1)
    await left.close(); await right.close()

    fs.unlinkSync(path)
    const missing = load(path)
    assert.equal(missing.config.customBalances.length, 1, 'backup also recovers a missing ledger')
    await missing.close()
    fs.writeFileSync(path, Buffer.alloc(100))
    fs.writeFileSync(backupPath, '{invalid')
    const broken = load(path)
    assert.equal(broken.config.customBalances.length, 0, 'invalid backup falls back to defaults')
    await broken.close()

    const recoveryPath = join(root, 'sources.json')
    const sources = [{ id: 'previous', label: 'One', baseURL: 'http://127.0.0.1:8317' }, { id: 'keep', label: 'Two' }]
    const first = stripSecrets(sanitizeConfig({ ...fixtureConfig(), gatewayQuotas: { sources } }))
    const next = { ...first, customBalances: [], gatewayQuotas: { sources: [first.gatewayQuotas.sources[1]] } }
    writeLedgerConfigBackup(recoveryPath, { config: first })
    writeLedgerConfigBackup(recoveryPath, { config: next })
    const savedSources = readLedgerConfigBackup(recoveryPath).quotaRecovery
    assert.deepEqual(savedSources.gatewayQuotas.sources.map(row => row.id), ['previous'])
    assert.deepEqual(savedSources.customBalances, first.customBalances)
    assert.equal(savedSources.customBalances[0].request.headers.Authorization, '{{BALANCE_TOKEN}}')
    assert.ok(!JSON.stringify(savedSources).includes('fixture-balance-secret'))
    writeLedgerConfigBackup(recoveryPath, { config: { ...next, locale: 'zh' } })
    assert.deepEqual(readLedgerConfigBackup(recoveryPath).quotaRecovery, savedSources)
    writeLedgerConfigBackup(recoveryPath, { config: first })
    assert.equal(readLedgerConfigBackup(recoveryPath).quotaRecovery, undefined, 'restored sources disappear from recovery')

    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--io-faults'], { encoding: 'utf8', timeout: 30000 })
    assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`)
  }
} finally {
  for (const ledger of ledgers) await ledger.close()
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
console.log('[ok] ledger config backup: zeroed/missing ledger recovery, secret filtering, concurrent workers and durable write failures')
