import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Ledger, sanitizeConfig } from '../lib/store.js'
import { startLedgerWrite } from '../lib/ledger-writer.js'
import { getSessionCost } from '../lib/session-tree.js'

const root = mkdtempSync(join(tmpdir(), 'cm-ledger-read-coalescing-'))
const ledgers = []
const account = (ledger, id, input = 100) => ledger.account(
  { input, output: 20 }, 'deepseek-v4-flash', id, Date.now(), 'deepseek')
const fresh = name => {
  const ledger = Ledger.load(join(root, name, 'ledger.json'))
  ledgers.push(ledger)
  return ledger
}
const read = ledger => JSON.parse(readFileSync(ledger.path, 'utf8'))

try {
  // Isolate the deadline from machine speed and count transactions before any real I/O.
  let now = 0, writes = 0
  const timers = new Set()
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout
  const scheduled = new Ledger(sanitizeConfig({}), {}, join(root, 'scheduled.json'), [], {
    backgroundWriter(payload, receive) {
      writes++
      const promise = new Promise(resolve => queueMicrotask(() => {
        receive({ ownDisk: true, revision: null, writeReceipts: [payload.transactionId] })
        resolve()
      }))
      return { promise, wait: () => true }
    },
  })
  try {
    globalThis.setTimeout = (fn, ms) => {
      const timer = { fn, at: now + ms }
      timers.add(timer)
      return timer
    }
    globalThis.clearTimeout = timer => timers.delete(timer)
    let originalTimer
    for (let i = 0; i < 8; i++) {
      now = i * 250
      account(scheduled, 'active')
      originalTimer ??= scheduled.writeTimer
      scheduled.refresh()
      if (scheduled.backgroundWrite) await scheduled.backgroundWrite.promise
      const cost = await getSessionCost(scheduled, {}, 'active')
      assert.equal(cost.own.calls, i + 1, 'reads include every uncommitted call')
      assert.equal(cost.own.input, (i + 1) * 100)
      assert.equal(scheduled.writeTimer, originalTimer, 'reads preserve the original deadline')
    }
    console.log('[coalescing]', JSON.stringify({ beforeDeadline: writes, calls: scheduled.sumDays().calls }))
    assert.equal(writes, 0, 'unchanged-revision reads keep updates inside the two-second window')
    assert.equal(originalTimer.at, 2000)
    now = 2000
    timers.delete(originalTimer)
    originalTimer.fn()
    const generation = scheduled.writeGeneration
    scheduled.refresh()
    assert.equal(scheduled.writeGeneration, generation, 'an inflight write gains no generation from a read')
    assert.equal(scheduled.writeTimer, null, 'an inflight transaction needs no extra save timer')
    await scheduled.backgroundWrite.promise
    assert.equal(writes, 1, 'the original deadline commits all eight calls together')
    assert.equal(scheduled.pendingWrite, false)
    assert.equal(scheduled.writeBase.days[Object.keys(scheduled.days)[0]].calls, 8)

    account(scheduled, 'missing-timer')
    clearTimeout(scheduled.writeTimer)
    scheduled.writeTimer = null
    scheduled.refresh()
    const recoveredTimer = scheduled.writeTimer
    assert.equal(recoveredTimer.at, now + 2000, 'pending data without a writer or timer gets bounded scheduling')
    now += 250
    scheduled.refresh()
    assert.equal(scheduled.writeTimer, recoveredTimer, 'later reads keep the recovered deadline')
    assert.equal(writes, 1)
    console.log('[ok] read scheduling: eight updates, original deadline, inflight generation and missing-timer recovery')
  } finally {
    await scheduled.close()
    globalThis.setTimeout = originalSet
    globalThis.clearTimeout = originalClear
  }

  // Exercise the shipped worker and real files through the routine timer.
  const routine = fresh('routine')
  let routineWrites = 0
  routine.startWrite = (payload, receive) => {
    routineWrites++
    return startLedgerWrite(payload, receive)
  }
  routine.refresh()
  for (let i = 0; i < 8; i++) {
    account(routine, 'active')
    routine.refresh()
    assert.equal((await getSessionCost(routine, {}, 'active')).own.calls, i + 1)
  }
  const expected = await getSessionCost(routine, {}, 'active')
  assert.equal(routineWrites, 0)
  await new Promise(resolve => setTimeout(resolve, 2100))
  if (routine.backgroundWrite) await routine.backgroundWrite.promise
  assert.equal(routineWrites, 1)
  assert.equal(routine.pendingWrite, false)
  assert.deepEqual((await getSessionCost(fresh('routine'), {}, 'active')).own, expected.own)
  assert.equal(expected.own.input, 800)
  assert.equal(expected.own.output, 160)

  const closing = fresh('close')
  account(closing, 'close-before-deadline')
  closing.refresh()
  assert.equal(closing.backgroundWrite, null)
  await closing.close()
  assert.equal(Object.values(read(closing).days)[0].calls, 1, 'close persists pending usage before the timer')

  // A real sibling process changes the revision while this reader has local pending usage.
  const shared = fresh('shared')
  shared.scheduleWrite()
  shared.flush()
  account(shared, 'local')
  shared.refresh()
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { Ledger } from ${JSON.stringify(new URL('../lib/store.js', import.meta.url).href)}
    const ledger = Ledger.load(process.argv[1])
    ledger.account({ input: 200, output: 20 }, 'deepseek-v4-flash', 'sibling', Date.now(), 'deepseek')
    ledger.flush()
    await ledger.close()
  `, shared.path], { stdio: 'pipe', timeout: 15000 })
  shared.refresh()
  assert.equal(shared.pendingWrite, false, 'a changed disk revision reconciles immediately')
  assert.equal(shared.sumDays().calls, 2)
  assert.equal(shared.sumDays().input, 300)
  assert.equal(Object.values(read(shared).days)[0].calls, 2)
  console.log('[ok] real persistence: one worker transaction, exact costs/tokens, close and sibling-process reconciliation')
} finally {
  for (const ledger of ledgers) await ledger.close()
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
