/** Process identity for local ledger locks; PID liveness alone cannot detect reuse. */
import { readFileSync, readlinkSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

const host = hostname()
// Freeze the Windows estimate at Node startup, before later wall-clock changes.
const ownStartMs = process.platform === 'win32' ? performance.timeOrigin : Date.now() - process.uptime() * 1000
const commandOptions = { encoding: 'utf8', timeout: 2000, maxBuffer: 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
let ownIdentity, ownNativeIdentity, clockTicks

function processIdentity(pid, legacy = false, native = false) {
  try {
    if (process.platform === 'linux') {
      // comm can itself contain spaces and ')'; field 22 follows its last ')'.
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      const start = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19]
      if (!/^\d+$/.test(start ?? '')) return null
      const boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()
      const namespace = readlinkSync(`/proc/${pid}/ns/pid`)
      if (!/^[a-f0-9-]{36}$/.test(boot) || !namespace) return null
      let startedAtMs = pid === process.pid ? ownStartMs : null
      if (legacy && pid !== process.pid) {
        clockTicks ??= Number(execFileSync('getconf', ['CLK_TCK'], commandOptions).trim())
        const bootTime = readFileSync('/proc/stat', 'utf8').match(/^btime (\d+)$/m)?.[1]
        if (Number.isFinite(clockTicks) && clockTicks > 0 && bootTime) startedAtMs = (Number(bootTime) + Number(start) / clockTicks) * 1000
      }
      return { platform: 'linux', boot, namespace, start, startedAtMs }
    }
    if (process.platform === 'win32') {
      // Uncontended writes need no PowerShell; only contention needs native data.
      if (pid === process.pid && !native) {
        return { platform: 'win32', start: String(Math.round(ownStartMs)), unit: 'ms', startedAtMs: ownStartMs }
      }
      const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      const start = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command',
        `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`], commandOptions).trim()
      if (!/^\d+$/.test(start)) return null
      return { platform: 'win32', start, startedAtMs: Number(BigInt(start) / 10000n - 62135596800000n) }
    }
  } catch { /* Missing process, permissions or OS tools: ownership remains unknown. */ }
  return null
}

function localIdentity() {
  if (ownIdentity === undefined) ownIdentity = processIdentity(process.pid)
  return ownIdentity
}

export function ledgerLockOwner() {
  const identity = localIdentity()
  // v1 readers compare Windows start strings as exact native ticks. An unknown
  // version makes them preserve a live ms owner rather than delete its lock.
  return JSON.stringify({ version: identity?.unit === 'ms' ? 2 : 1, host, identity })
}

/** Only dead processes, changed native identities or pre-birth legacy files qualify. */
export function staleLedgerLockOwner(path, pid, identities = new Map(), recordedOwner) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 2147483647) return false
  const text = recordedOwner === undefined ? readFileSync(path, 'utf8') : JSON.stringify(recordedOwner)
  let previous
  if (text !== '') {
    try { previous = JSON.parse(text) } catch { /* Incomplete owner write is not stale. */ }
    if (previous?.host && previous.host !== host) return false
    const local = localIdentity()
    // Same-boot locks in another PID namespace cannot be probed from this one.
    if (previous?.identity?.platform === 'linux' && local?.platform === 'linux'
      && previous.identity.boot === local.boot && previous.identity.namespace !== local.namespace) return false
  }
  try { process.kill(pid, 0) } catch (error) { return error.code === 'ESRCH' }
  const identity = (previous?.version === 1 || previous?.version === 2) && previous.identity
  if (text !== '' && (!identity || typeof identity.start !== 'string' || !/^\d+$/.test(identity.start))) return false
  if (process.platform === 'win32' && text !== '' && !(
    (previous.version === 1 && identity.platform === 'win32' && identity.unit === undefined)
    || (previous.version === 2 && identity.platform === 'win32' && identity.unit === 'ms')
  )) return false
  if (process.platform === 'linux' && text !== '' && previous.version !== 1) return false
  if (pid !== process.pid && !identities.has(pid)) identities.set(pid, processIdentity(pid, text === ''))
  let current = pid === process.pid ? localIdentity() : identities.get(pid)
  // A v1 native lock must retain exact comparison even when it names our PID.
  if (pid === process.pid && process.platform === 'win32' && previous?.version === 1) {
    if (ownNativeIdentity === undefined) ownNativeIdentity = processIdentity(pid, false, true)
    current = ownNativeIdentity
  }
  if (text === '') {
    // v1.8.13 and earlier wrote empty owner files. Allow for timestamp precision
    // and startup-time estimation; ordinary old locks are never expired by age.
    const start = pid === process.pid ? (current?.startedAtMs ?? ownStartMs) : current?.startedAtMs
    return Number.isFinite(start) && statSync(path).mtimeMs < start - 2000
  }
  if (!identity || !current || identity.platform !== current.platform || typeof identity.start !== 'string' || !/^\d+$/.test(identity.start)) return false
  if (current.platform === 'linux') {
    if (typeof identity.boot !== 'string' || typeof identity.namespace !== 'string') return false
    return identity.boot !== current.boot || identity.start !== current.start
  }
  // Normalize native ticks before comparing with v2 milliseconds. Only an
  // earlier birth qualifies: a later/uncertain estimate cannot prove PID reuse.
  if (identity.unit === 'ms' || current.unit === 'ms') {
    const toMs = value => value.unit === 'ms' ? Number(value.start) : Number(BigInt(value.start) / 10000n - 62135596800000n)
    const previousStart = toMs(identity), currentStart = toMs(current)
    if (!Number.isSafeInteger(previousStart) || previousStart <= 0 || !Number.isSafeInteger(currentStart) || currentStart <= 0) return false
    return previousStart < currentStart - 2000
  }
  return identity.start !== current.start
}
