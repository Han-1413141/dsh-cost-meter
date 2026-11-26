import { createServer } from 'node:http'
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { queryAccountTarget } from './query-accounts.js'

const SOURCE = 'codingPlans.commandcode'
const DEFAULT_REF = 'COMMANDCODE_API_KEY'
const STUDIO = 'https://commandcode.ai'
const WHOAMI = 'https://api.commandcode.ai/alpha/whoami'

function accountTarget(config, id) {
  return queryAccountTarget(config, SOURCE + '@' + id, base => base === SOURCE ? DEFAULT_REF : null)
}

export function commandCodeSlots(config, enabledAccountIds = ['default']) {
  const rows = config?.queryAccounts?.[SOURCE]?.accounts ?? []
  return [{ id: 'default', label: 'Default' }, ...rows]
    .filter(row => enabledAccountIds.includes(row.id))
    .map(row => ({ ...row, ref: accountTarget(config, row.id)?.ref, allowAuthFile: false }))
    .filter(row => row.ref)
}

const isEnvironmentSource = source => ['env', 'project-env', 'user-env'].includes(source)

// Keep cancellation reversible across an asynchronous host store write. Callers
// serialize operations on the same ref, including explicit clears and replacements.
export async function saveCommandCodeCredential(credentials, name, value, current) {
  const ref = credentialRef(name)
  const previous = await credentials.resolve(ref)
  if (!current()) throw new Error('cancelled')
  await credentials.set(ref, value)
  if (current()) return
  // A newer change made outside the plugin takes precedence.
  if ((await credentials.resolve(ref))?.value === value) {
    if (previous?.value && !isEnvironmentSource(previous.source)) await credentials.set(ref, previous.value)
    else await credentials.unset(ref)
  }
  throw new Error('cancelled')
}

async function readCredential(ctx, config, ref) {
  const credentials = ctx?.get?.('credentials')
  try {
    const hit = await credentials?.resolve(credentialRef(ref))
    if (hit?.value?.trim()) return { value: hit.value.trim(), source: isEnvironmentSource(hit.source) ? 'env' : 'store' }
  } catch { /* The default slot can also use its launch environment or a pending migration. */ }
  if (ref === DEFAULT_REF) {
    if (process.env[ref]?.trim()) return { value: process.env[ref].trim(), source: 'env' }
    const legacy = config?.codingPlans?.commandcode?.apiKey?.trim()
    if (legacy) return { value: legacy, source: 'legacy' }
  }
  return { source: 'none' }
}

export async function resolveCommandCodeRef(ctx, config, ref) {
  const ids = config?.queryAccounts?.[SOURCE]?.accounts?.map(row => row.id) ?? []
  if (!commandCodeSlots(config, ['default', ...ids]).some(slot => slot.ref === ref)) return undefined
  return (await readCredential(ctx, config, ref)).value
}

const deriveSignature = promisify(scrypt)
const validKey = key => typeof key === 'string' && key.length <= 8192 && /^[\x21-\x7e]+$/.test(key)

async function validateKey(key, signal, fetchImpl) {
  if (!validKey(key)) return 'invalid-key'
  try {
    const response = await fetchImpl(WHOAMI, {
      headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
      redirect: 'error', cache: 'no-store', signal,
    })
    await response.body?.cancel().catch(() => {})
    if (response.status === 401 || response.status === 403) return 'invalid-key'
    return response.ok ? 'ok' : 'server-error'
  } catch {
    return signal.aborted ? 'timeout' : 'network'
  }
}

function respond(response, status, success = false) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Connection: 'close' })
  response.end(JSON.stringify({ success }))
}

// Studio posts a key and the opaque state to its supplied loopback callback.
// The server accepts credentials only for its own live attempt and Studio origin.
export function createCommandCodeAuth({ ctx, config, save, timeoutMs = 120_000, fetchImpl = (...args) => fetch(...args) }) {
  const records = new Map()
  const checks = new WeakMap()
  let current
  let disposed = false
  function finish(attempt, status) {
    if (current !== attempt) return
    current = null
    attempt.outcome = status
    clearTimeout(attempt.timer)
    attempt.controller.abort()
    attempt.server?.close()
    attempt.server?.closeAllConnections()
    attempt.finishBinding?.()
    records.set(attempt.id, { ...records.get(attempt.id), status })
  }
  function cancel(id) {
    if (current && (id === undefined || current.id === id)) finish(current, 'cancelled')
  }
  function forget(id) {
    cancel(id)
    records.delete(id)
  }
  function known(id) { return !disposed && accountTarget(config(), id) }
  function live(attempt) { return current === attempt && !!known(attempt.id) }
  async function check(attempt, value, store) {
    const result = await validateKey(value, attempt.controller.signal, fetchImpl)
    if (!live(attempt)) return attempt.outcome ?? 'cancelled'
    if (result !== 'ok') { finish(attempt, result); return result }
    // Complete the slow derivation before writing the credential, so cancellation
    // during that operation leaves both the stored key and its prior record intact.
    const salt = randomBytes(32)
    let signature
    try {
      signature = await deriveSignature(value, salt, 32)
      if (!live(attempt)) return attempt.outcome ?? 'cancelled'
      if (store) await save(attempt.id, value, () => live(attempt))
    } catch {
      if (current === attempt) finish(attempt, 'unavailable')
      return attempt.outcome ?? 'unavailable'
    }
    if (!live(attempt)) return attempt.outcome ?? 'cancelled'
    records.set(attempt.id, { validatedAt: Date.now(), salt, signature })
    finish(attempt, 'ok')
    return 'ok'
  }
  function makeAttempt(id, status) {
    const attempt = { id, status, controller: new AbortController() }
    current = attempt
    attempt.timer = setTimeout(() => finish(attempt, 'timeout'), timeoutMs)
    attempt.timer.unref?.()
    return attempt
  }
  function matchesSignature(record, value) {
    // Concurrent settings views can share a derivation for the same credential.
    // Retain the candidate only until the host worker returns.
    const existing = checks.get(record)
    if (existing?.value === value) return existing.promise
    const entry = { value }
    entry.promise = deriveSignature(value, record.salt, record.signature.length)
      .then(candidate => timingSafeEqual(candidate, record.signature))
      .finally(() => { if (checks.get(record) === entry) checks.delete(record) })
    checks.set(record, entry)
    return entry.promise
  }
  async function snapshot(id, override) {
    const target = known(id)
    const record = records.get(id)
    let credential = target ? await readCredential(ctx, config(), target.ref) : { source: 'none' }
    let unchanged = false
    if (record?.signature && validKey(credential.value)) {
      const matched = await matchesSignature(record, credential.value)
      // External clients can update the host credential while scrypt is running.
      // Check the source again before reporting a validation for the old key.
      const latest = known(id) ? await readCredential(ctx, config(), target.ref) : { source: 'none' }
      unchanged = credential.value === latest.value && matched
      credential = latest
    }
    if (record !== records.get(id)) return snapshot(id, override)
    const attempt = current?.id === id ? current : null
    let status = record?.status ?? 'idle'
    if (status === 'ok' && !unchanged) status = credential.value ? 'idle' : 'missing'
    return {
      accountId: id, status: override ?? attempt?.status ?? status,
      credentialSource: credential.source, validatedAt: unchanged ? record.validatedAt : null,
      ...(attempt?.url && attempt.status === 'waiting' && !override ? { authUrl: attempt.url } : {}),
    }
  }
  async function begin(id) {
    if (current) {
      if (current.id !== id || !current.server) return snapshot(id, 'busy')
      await current.binding
      return snapshot(id)
    }
    if (!ctx.get('credentials')?.set) return snapshot(id, 'unavailable')
    const attempt = makeAttempt(id, 'waiting')
    const state = randomBytes(32).toString('base64url')
    const server = createServer({ maxHeaderSize: 8192, requestTimeout: 10_000 }, async (request, response) => {
      if (request.url !== '/callback') return respond(response, 404)
      if (request.headers.origin !== STUDIO) return respond(response, 403)
      response.setHeader('Access-Control-Allow-Origin', STUDIO)
      response.setHeader('Vary', 'Origin')
      if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Methods', 'POST')
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
        response.setHeader('Access-Control-Allow-Private-Network', 'true')
        return respond(response, 204)
      }
      if (request.method !== 'POST') return respond(response, 405)
      if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') return respond(response, 415)
      const chunks = []
      let size = 0
      try {
        for await (const chunk of request) {
          size += chunk.length
          if (size > 10_000) return respond(response, 413)
          chunks.push(chunk)
        }
      } catch { return }
      let data
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return respond(response, 400) }
      if (data?.state !== state) return respond(response, 403)
      if (!live(attempt) || attempt.status !== 'waiting') return respond(response, 409)
      if (data.error) {
        attempt.status = 'validating'
        response.once('finish', () => finish(attempt, 'denied'))
        return respond(response, 200, true)
      }
      if (typeof data.apiKey !== 'string' || !data.apiKey) return respond(response, 400)
      attempt.status = 'validating'
      response.once('finish', () => { server.close(); void check(attempt, data.apiKey, true) })
      respond(response, 200, true)
    })
    server.unref()
    attempt.server = server
    attempt.binding = new Promise(resolve => {
      attempt.finishBinding = resolve
      // Use the same ten loopback ports as the official desktop CLI.
      let port = 5959
      server.on('error', error => {
        if (error.code === 'EADDRINUSE' && port < 5968 && live(attempt)) {
          server.listen(++port, '127.0.0.1')
        } else {
          finish(attempt, 'unavailable')
          resolve()
        }
      })
      server.once('listening', () => {
        if (live(attempt)) {
          const url = new URL('/studio/auth/cli', STUDIO)
          url.searchParams.set('callback', 'http://localhost:' + server.address().port + '/callback')
          url.searchParams.set('state', state)
          attempt.url = url.href
        } else { server.close() }
        resolve()
      })
      server.listen(port, '127.0.0.1')
    })
    await attempt.binding
    return snapshot(id)
  }
  return {
    async rpc({ action, accountId: id }) {
      const target = known(id)
      if (!target) return snapshot(id, 'missing')
      if (action === 'login') return begin(id)
      if (action === 'cancel') cancel(id)
      if (action === 'validate') {
        if (current) return snapshot(id, 'busy')
        const attempt = makeAttempt(id, 'validating')
        const { value } = await readCredential(ctx, config(), target.ref)
        if (live(attempt)) {
          if (value) await check(attempt, value, false)
          else finish(attempt, 'missing')
        }
      }
      return snapshot(id)
    },
    async replace(id, value) {
      if (!known(id)) return 'missing'
      if (current?.id !== id && current) return 'busy'
      cancel(id)
      return check(makeAttempt(id, 'validating'), value, true)
    },
    forget,
    prune() {
      if (current && !known(current.id)) cancel(current.id)
      for (const id of records.keys()) if (!known(id)) records.delete(id)
    },
    dispose() { disposed = true; cancel(); records.clear() },
  }
}
