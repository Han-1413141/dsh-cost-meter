import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Ledger, defaultConfig, localDayKey } from '../lib/store.js'
import { withLedgerLock } from '../lib/ledger-persistence.js'

const filename = fileURLToPath(import.meta.url)
const now = Date.now()
const day = localDayKey(now)
const call = (ledger, id, input = 10) => ledger.account({ input, output: 2 }, 'deepseek-v4-flash', id, now, 'deepseek')

if (process.argv[2] === '--worker') {
  const ledger = Ledger.open()
  if (process.argv[3] === 'crash') {
    withLedgerLock(ledger.path, () => process.exit(0))
  } else {
    // Every child reads the same starting snapshot before the parent releases it.
    process.send('ready')
    process.once('message', () => {
      for (let i = 0; i < 6; i++) call(ledger, `${process.pid}-${i}`)
      call(ledger, 'shared-session')
      call(ledger, undefined)
      ledger.close()
      process.exit(ledger.pendingWrite ? 1 : 0)
    })
  }
} else {
  const root = mkdtempSync(join(tmpdir(), 'cm-ledger-concurrency-'))
  const previousHome = process.env.DSH_HOME
  const ledgers = []
  let counter = 0
  const create = (path, config = defaultConfig()) => {
    const ledger = new Ledger(config, {}, path)
    ledgers.push(ledger)
    return ledger
  }
  const freshPath = () => join(root, String(++counter), 'ledger.json')
  const reopen = path => {
    const ledger = withLedgerLock(path, () => Ledger.load(path))
    ledgers.push(ledger)
    return ledger
  }
  const save = ledger => { ledger.scheduleWrite(); ledger.flush(); assert.equal(ledger.pendingWrite, false) }
  const read = path => JSON.parse(readFileSync(path, 'utf8'))
  const launch = mode => {
    const child = fork(filename, ['--worker', mode], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })
    const ready = new Promise((resolve, reject) => {
      child.once('message', resolve)
      child.once('error', reject)
      child.once('exit', code => { if (code !== 0) reject(new Error(`Worker exited ${code}`)) })
    })
    const done = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Worker exited ${code}`)))
    })
    return { child, ready, done }
  }
  try {
    // A long-running web process must retain sequential and simultaneous headless writes.
    const path = freshPath(), web = create(path)
    call(web, 'seed'); save(web)
    const a = reopen(path), b = reopen(path)
    call(a, 'a'); call(b, 'b'); call(a, 'shared'); call(b, 'shared')
    call(a, undefined); call(b, undefined)
    save(a); save(b)
    web.config.historyDays = 90
    save(web)
    let disk = read(path)
    assert.equal(disk.days[day].calls, 7)
    assert.equal(disk.days[day].sessions.find(s => s.id === 'shared').calls, 2)
    assert.equal(disk.days[day].byProviderModel['deepseek:deepseek-v4-flash'].input, 70)
    save(a); save(b); save(web)
    assert.equal(read(path).days[day].calls, 7, 'Repeated flushes never replay committed calls')
    assert.equal(a.config.historyDays, 90, 'Unchanged settings adopt the disk value')

    // Both sides can change different settings without replacing the whole config.
    const c = reopen(path), d = reopen(path)
    c.config.currency = 'CNY'; d.config.historyDays = 60
    save(c); save(d)
    assert.equal(read(path).config.currency, 'CNY')
    assert.equal(read(path).config.historyDays, 60)

    const planPath = freshPath(), cfg = defaultConfig()
    cfg.planBilling.providers.deepseek = 'plan'
    // Go is a recognized plan provider; direct account() calls use its hourly bucket.
    cfg.planBilling.providers.go = 'plan'
    const pa = create(planPath, cfg); save(pa)
    const pb = reopen(planPath)
    for (const [ledger, id, t] of [[pa, 'p-a', now - 120000], [pb, 'p-b', now]]) {
      ledger.account({ input: 30, output: 5 }, 'deepseek-v4-flash', id, now, 'opencode-go')
      ledger.planSamples = { go: { rolling: [{ t, p: 5, lt: 35, lc: 0, r: '', s: 0 }] } }
      save(ledger)
    }
    disk = read(planPath)
    assert.equal(disk.days[day].calls, 2)
    assert.equal(disk.planHourBuckets.go[Math.floor(now / 3600000) * 3600000].tokens, 70)
    assert.equal(disk.planSamples.go.rolling.length, 2)
    save(pa); save(pb)
    assert.equal(read(planPath).planHourBuckets.go[Math.floor(now / 3600000) * 3600000].tokens, 70)

    // Every session stays attributable beyond the former daily 200-session cap.
    const capPath = freshPath(), cap = create(capPath)
    for (let i = 0; i < 205; i++) call(cap, `old-${i}`)
    save(cap)
    const capOther = reopen(capPath)
    call(cap, 'new-a'); call(capOther, 'new-b'); save(cap); save(capOther)
    assert.equal(read(capPath).days[day].calls, 207)
    assert.equal(read(capPath).days[day].sessions.length, 207)
    assert.ok(read(capPath).days[day].sessions.some(s => s.id === 'old-0'))
    assert.ok(Math.abs(read(capPath).days[day].sessions.reduce((sum, row) => sum + row.cost, 0) - read(capPath).days[day].cost) < 1e-8)
    assert.ok(read(capPath).days[day].sessions.some(s => s.id === 'new-a'))
    assert.ok(read(capPath).days[day].sessions.some(s => s.id === 'new-b'))

    // Concurrent history imports have shared and distinct sessions with equal
    // numeric totals: union the former once and retain the latter separately.
    const importPath = freshPath(), ia = create(importPath), ib = create(importPath)
    const historical = ids => {
      const source = create(freshPath())
      for (const id of ids) call(source, id)
      source.pendingWrite = false
      source.pendingAccounts = []
      return structuredClone(source.days)
    }
    ia.days = historical(['common', 'import-a'])
    ib.days = historical(['common', 'import-b'])
    save(ia); save(ib)
    disk = read(importPath)
    assert.equal(disk.days[day].calls, 3)
    assert.equal(disk.days[day].input, 30)
    assert.equal(disk.days[day].byProviderModel['deepseek:deepseek-v4-flash'].calls, 3)
    assert.equal(disk.days[day].sessions.length, 3)
    save(ia); assert.equal(read(importPath).days[day].calls, 3)

    // A reset invalidates stale snapshots and already-pending pre-reset calls.
    const resetPath = freshPath(), resetter = create(resetPath)
    call(resetter, 'old'); save(resetter)
    const stale = reopen(resetPath)
    call(stale, 'before-reset')
    resetter.resetHistory(); save(resetter)
    stale.config.historyDays = 45; save(stale)
    assert.deepEqual(read(resetPath).days, {})
    const staleAgain = reopen(resetPath)
    call(resetter, 'after-reset'); save(resetter)
    save(staleAgain)
    assert.equal(read(resetPath).days[day].calls, 1)
    assert.equal(read(resetPath).days[day].sessions[0].id, 'after-reset')
    const beforeSecondReset = reopen(resetPath)
    resetter.resetHistory(); save(resetter)
    await new Promise(resolve => setTimeout(resolve, 5))
    call(beforeSecondReset, 'fresh-call-from-stale-process'); save(beforeSecondReset)
    assert.equal(read(resetPath).days[day].calls, 1)
    assert.equal(read(resetPath).days[day].sessions[0].id, 'fresh-call-from-stale-process')

    // Malformed disk data must not be overwritten; successful retry commits once.
    const retryPath = freshPath(), retry = create(retryPath)
    call(retry, 'retry')
    mkdirSync(dirname(retryPath), { recursive: true })
    writeFileSync(retryPath, '{broken')
    const warn = console.warn
    try { console.warn = () => {}; retry.flush() } finally { console.warn = warn }
    assert.equal(retry.pendingWrite, true)
    assert.equal(readFileSync(retryPath, 'utf8'), '{broken')
    rmSync(retryPath); save(retry); save(retry)
    assert.equal(read(retryPath).days[day].calls, 1)
    assert.equal(readdirSync(dirname(retryPath)).some(n => n.endsWith('.tmp') || n.endsWith('.lock')), false)

    process.env.DSH_HOME = join(root, 'processes')
    const shared = Ledger.open(); ledgers.push(shared)
    call(shared, 'seed'); save(shared)
    const children = Array.from({ length: 8 }, () => launch('write'))
    await Promise.all(children.map(c => c.ready))
    for (const child of children) child.child.send('flush')
    await Promise.all(children.map(c => c.done))
    save(shared)
    disk = read(shared.path)
    assert.equal(disk.days[day].calls, 65, 'Eight real processes each persist all eight calls')
    assert.equal(disk.days[day].sessions.length, 50)
    assert.equal(disk.days[day].sessions.find(s => s.id === 'shared-session').calls, 8)

    await launch('crash').done
    call(shared, 'after-crash'); save(shared)
    assert.equal(read(shared.path).days[day].calls, 66, 'Dead process lock is recovered')
    withLedgerLock(shared.path, () => {
      assert.throws(() => withLedgerLock(shared.path, () => {}, 25), /busy/, 'A live owner cannot be evicted')
    })
    console.log('[ok] Concurrent ledger writes, stale web snapshots, shared sessions, plan buckets, resets, retry and crash recovery')
  } finally {
    for (const ledger of ledgers) ledger.close()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    rmSync(root, { recursive: true, force: true })
  }
}
