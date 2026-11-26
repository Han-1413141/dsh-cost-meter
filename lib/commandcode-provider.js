import { join } from 'node:path'
import { commandCodeSettingsNamespace } from './commandcode-settings-namespace.js'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { commandCodeSlots, resolveCommandCodeRef } from './commandcode-auth.js'
import { COMMANDCODE_ORIGIN, normalizeCommandCodeSettings } from './commandcode-settings.js'

const route = 'commandcode'
const getService = (ctx, name) => typeof ctx?.get === 'function' ? ctx.get(name) : ctx?.[name]

async function fetchCatalog(send, url, init) {
  const read = async (response) => {
    if (!response.ok || !response.body) { void response.body?.cancel().catch(() => {}); throw Error('Command Code catalogue unavailable') }
    const reader = response.body.getReader()
    let size = 0
    const chunks = []
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 2_097_152) throw Error('Command Code catalogue is too large')
        chunks.push(value)
      }
    } finally { void reader.cancel().catch(() => {}) }
    return JSON.parse(Buffer.concat(chunks).toString())
  }
  const [catalog, details] = await Promise.all([
    send(url.href, init).then(read),
    send(url.href + '?view=client', { ...init, signal: AbortSignal.any([init.signal, AbortSignal.timeout(5000)]) }).then(read).catch(() => null),
  ])
  const metadata = new Map((Array.isArray(details?.data) ? details.data : []).map(row => [row?.id, row]))
  // The inference catalogue owns routability and endpoints. The client view
  // provides the modalities, plan, output limits and promotion for the same ID.
  for (const model of Array.isArray(catalog?.data) ? catalog.data : []) {
    const entry = metadata.get(model?.id)
    if (!entry) continue
    if (Array.isArray(entry.inputModalities)) model.image = entry.inputModalities.includes('image')
    if (Array.isArray(entry.reasoningEfforts)) model.reasoningEfforts = entry.reasoningEfforts
    if (typeof entry.minimumPlan === 'string') model.minimumPlan = entry.minimumPlan.replace(/^individual-/, '')
    if (Number.isSafeInteger(entry.maxOutputTokens)) model.max_output_tokens = entry.maxOutputTokens
    if (typeof entry.display?.badge === 'string') model.deal = entry.display.badge
  }
  return Response.json(catalog)
}

function makeTrustedFetch(lifetime, send) {
  return async (target, init = {}) => {
    const url = new URL(target)
    if (url.origin !== COMMANDCODE_ORIGIN || url.username || url.password) throw Error('Invalid Command Code API origin')
    const signal = init.signal ? AbortSignal.any([lifetime, init.signal]) : lifetime
    signal.throwIfAborted()
    const options = { ...init, signal, redirect: 'error' }
    if (url.pathname === '/provider/v1/models') return fetchCatalog(send, url, options)
    const response = await send(url.href, options)
    if (response.ok) return response
    // Error bodies are used for rotation and protocol negotiation. Redact any
    // echoed request credential before handing the text to the adapter.
    const headers = new Headers(init.headers)
    const secret = (headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '') || headers.get('x-api-key')
    if (!secret || !response.body) return response
    const reader = response.body.getReader()
    const parts = []
    let length = 0
    try {
      while (length < 32_768) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(Buffer.from(value.subarray(0, 32_768 - length)))
        length += value.length
      }
    } finally { void reader.cancel().catch(() => {}) }
    const message = Buffer.concat(parts).toString('utf8').replaceAll(secret, '[redacted]')
    return new Response(message, { status: response.status, headers: response.headers })
  }
}

function buildAdapter(ctx, ledger, vendor, fetchImpl) {
  const settings = () => normalizeCommandCodeSettings(ledger.config.commandCodeProvider)
  const options = () => {
    const config = settings()
    return { ...config, filterModelsByPlan: false, workingDir: '/workspace',
      modelsCachePath: join(resolveDshHome(), 'storages', 'cost-meter', 'commandcode-models.json'),
      streamIdleTimeoutMs: config.requestTimeoutMs,
      slots: commandCodeSlots(ledger.config, config.inferenceAccounts),
      preferredId: config.preferredAccount || undefined,
      modelAccountRules: Object.entries(config.modelAccounts).map(([model, account]) => ({ models: [model], account })),
    }
  }
  let servingAccountId = null
  const pool = new vendor.CommandCodeAccountPool({
    slots: () => options().slots,
    resolveRef: ref => resolveCommandCodeRef(ctx, ledger.config, ref),
    authFileKey: () => undefined,
    probeWindow: key => adapter.probeWindowLimits(key),
  })
  const scope = connection => pool.scope({ ...connection, probeWindow: key => adapter.probeWindowLimits(key, connection) })
  async function resolveKey(connection, model, tried) {
    const entry = await scope(connection).resolveKey({ model, tried })
    if (entry && model) servingAccountId = entry.slot.id
    return entry ? vendor.assertUsableApiKey(entry.key, 'dsh-cost-meter', entry.slot.ref) : undefined
  }
  class MeterAdapter extends vendor.CommandCodeAdapter {
    providerRetryPolicy(provider) {
      return { ...super.providerRetryPolicy(provider), maxRetries: settings().retryLimit }
    }
    async listModels(provider, listOptions) {
      const rows = await super.listModels(provider, listOptions)
      const config = settings()
      return listOptions?.unfiltered || !config.favoritesOnly ? rows : rows.filter(row => config.favorites.includes(row.id))
    }
    async resolveModel(provider, model, signal) {
      const resolved = await super.resolveModel(provider, model, signal)
      const limit = settings().outputLimits[model]
      return !resolved || !limit ? resolved : { ...resolved, defaultMaxTokens: Math.min(resolved.defaultMaxTokens ?? limit, limit) }
    }
    stream(request) {
      const config = settings()
      const limit = config.outputLimits[request.model]
      return super.stream({ ...request,
        ...(limit ? { maxTokens: Math.min(request.maxTokens ?? limit, limit) } : {}),
        reasoningEffort: request.reasoningEffort ?? config.reasoningEfforts[request.model],
      })
    }
  }
  const adapter = new MeterAdapter({
    options, fetchImpl,
    resolveApiKey: async (connection, model) => {
      const key = await resolveKey(connection, model)
      if (!key) {
        const { LlmError } = await import('./commandcode-host-llm.js')
        throw new LlmError('Configure an inference account in Command Code settings.', 'MISSING_CREDENTIAL')
      }
      return key
    },
    rotateApiKey: async (key, reason, connection, model, rotation) => {
      const group = scope(connection)
      if (reason === 'unavailable') group.markModelUnavailable(key, model)
      else group.markRejected(key, reason, rotation?.resetAtMs)
      return resolveKey(connection, model, rotation?.tried?.length ? rotation.tried : [key])
    },
    resolveAccountKeys: async connection => (await scope(connection).resolvedAccounts()).map(row => row.key),
    resolveAttachments: () => {
      const service = getService(ctx, 'attachments')
      if (!service?.readImageRequest) return undefined
      return { async readImageRequest(ref, target) {
        const image = await service.readImageRequest(ref, target)
        if (!image || !(image.data instanceof Uint8Array) || image.data.byteLength > target.maxBytes) {
          const { LlmError } = await import('./commandcode-host-llm.js')
          throw new LlmError('Command Code attachment exceeds the request image limit.', 'UNSUPPORTED_CONTENT')
        }
        return image
      } }
    },
  })
  let models = [], catalogAccountId = null
  return {
    adapter, fetchImpl,
    searchKey: () => resolveKey(options()),
    async refreshModels(accountId) {
      const connection = options()
      // The editor may inspect a quota-only account before opting it into
      // inference. Scope this catalogue check without changing its route.
      const inspection = accountId ? { ...connection, slots: commandCodeSlots(ledger.config, [accountId]) } : connection
      const [catalog, accounts] = await Promise.all([
        adapter.gatewayFacts.refresh(connection, undefined, true), scope(inspection).resolvedAccounts(),
      ])
      const selected = accounts.find(row => row.slot.id === (accountId || servingAccountId || connection.preferredId)) ?? accounts[0]
      const access = selected ? await adapter.loadBillingAccessForKey(connection.apiBase, selected.key) : undefined
      catalogAccountId = selected?.slot.id ?? null
      models = catalog.map(model => {
        const tier = model.minimumPlan ?? vendor.KNOWN_PLANS[model.id]
        const weight = vendor.PLAN_ORDER[tier]
        return { id: model.id, name: model.name, contextWindow: model.contextWindow,
          image: model.image ?? vendor.KNOWN_IMAGE_MODELS.has(model.id), reasoningEfforts: model.reasoningEfforts ?? vendor.KNOWN_EFFORTS[model.id] ?? [],
          tier, deal: model.deal ?? vendor.dealLabel(model.id), peak: vendor.peakPricingLabel(model.id),
          ...(access?.tierWeight !== undefined && weight !== undefined ? { available: access.onDemandCredits > 0 || weight <= access.tierWeight } : {}),
        }
      })
    },
    async snapshot() {
      const connection = options()
      const accounts = await scope(connection).describeAccounts()
      const health = Object.fromEntries(connection.slots.map(slot => [slot.id, { status: 'unconfigured' }]))
      for (const { slot, state } of accounts) {
        health[slot.id] = { status: !state || vendor.accountUsable(state) ? 'ready' : state.cause,
          ...(state?.until > Date.now() ? { resetAt: state.until } : {}) }
      }
      return { models, health, catalogAccountId, servingAccountId: accounts.some(row => row.slot.id === servingAccountId) ? servingAccountId : null }
    },
  }
}

function registerWebSearch(ctx, runtime, settings, vendor) {
  const web = getService(ctx, 'web')
  if (!web?.registerSearchProvider || !settings.webSearch) return
  const disposers = []
  const selection = web.config?.searchProvider
  let original
  try {
    const providers = web.listProviders().search
    if (settings.searchProvider === route && !providers.some(row => row.id === route)) {
      disposers.push(web.registerSearchProvider(new vendor.CommandCodeSearchProvider({
        resolveKey: runtime.searchKey, apiBase: () => COMMANDCODE_ORIGIN, fetchImpl: runtime.fetchImpl,
      })))
    }
    if (!web.listProviders().search.some(row => row.id === settings.searchProvider)) throw Error('Unknown web search provider')
    if (selection?.get && typeof selection[Symbol.for('cosmokit.volatile.write')] === 'function') {
      original = selection.get()
      const write = value => selection[Symbol.for('cosmokit.volatile.write')](value)
      write(settings.searchProvider)
      disposers.push(() => { if (selection.get() === settings.searchProvider) write(original) })
    } else throw Error('No live web-search selection')
  } catch (error) { for (const dispose of disposers.reverse()) dispose(); throw error }
  return () => { for (const dispose of disposers.reverse()) dispose() }
}

export function installCommandCodeProvider(ctx, ledger, { send = (...args) => globalThis.fetch(...args) } = {}) {
  let host, runtime, status = 'disabled', release, webRelease, retryLimit, webIdentity, pending = Promise.resolve(), revision = 0
  let disposed = false
  const config = () => normalizeCommandCodeSettings(ledger.config.commandCodeProvider)
  function stop() {
    webRelease?.(); webRelease = undefined; webIdentity = undefined
    release?.(); release = undefined; runtime = undefined
  }
  async function reconcile() {
    const epoch = ++revision
    const settings = config()
    if (!settings.enabled || !host || disposed) { stop(); status = settings.enabled ? 'host-unavailable' : 'disabled'; return }
    if (runtime && retryLimit !== settings.retryLimit) stop()
    if (!runtime) {
      const llm = getService(host, 'llm')
      if (!llm?.registerAdapter || !llm.registerConfigurableProviders) { status = 'host-unavailable'; return }
      if (llm.listProviders().some(row => row.id === route) || llm.listConfigurableProviders().some(row => row.provider === route)) { status = 'route-in-use'; return }
      let vendor
      try { vendor = await import('./commandcode-vendor/protocol.js') } catch { status = 'host-unavailable'; return }
      if (epoch !== revision || disposed) return
      const lifetime = new AbortController()
      const service = buildAdapter(host, ledger, vendor, makeTrustedFetch(lifetime.signal, send))
      const disposers = []
      const teardown = () => {
        lifetime.abort()
        for (const dispose of disposers.splice(0).reverse()) dispose()
      }
      try {
        disposers.push(llm.registerAdapter([route], service.adapter))
        disposers.push(llm.registerConfigurableProviders([{ provider: route, displayName: 'Command Code',
          settingsNs: commandCodeSettingsNamespace(ctx), settingsPath: ['commandcode'] }]))
        // Newer hosts substitute a text placeholder for images before dispatch.
        // Check this route's original input while the attachment is still visible.
        const guard = host.on('llm/stream', (request, next) => {
          if (request.provider !== route || !request.messages?.some(message => message.content?.some?.(block => block.type === 'image'))) return next()
          return (async function* () {
            const model = await service.adapter.resolveModel(route, request.model, request.signal)
            if (!model?.inputModalities?.includes('image')) {
              yield { type: 'finish', reason: { kind: 'error', failure: {
                code: 'UNSUPPORTED_CONTENT', message: 'This Command Code model does not support image input.',
              } } }
              return
            }
            yield* next()
          })()
        })
        disposers.push(guard)
        release = teardown
      } catch { teardown(); status = 'registration-failed'; return }
      runtime = service; retryLimit = settings.retryLimit
    }
    status = 'ready'
    const identity = JSON.stringify([settings.webSearch, settings.searchProvider])
    if (identity === webIdentity) return
    webRelease?.(); webRelease = undefined
    if (settings.webSearch && getService(host, 'web')) {
      try {
        const vendor = await import('./commandcode-vendor/search.js')
        if (epoch !== revision || disposed) return
        webRelease = registerWebSearch(host, runtime, settings, vendor)
      } catch { status = 'search-unavailable'; return }
    } else if (settings.webSearch) { status = 'search-unavailable'; return }
    webIdentity = identity
  }
  const settingsChanged = () => { pending = reconcile().catch(() => { status = 'host-unavailable' }); return pending }
  ctx.inject(['llm'], scope => {
    host = scope
    void settingsChanged()
    scope.effect(() => () => { if (host === scope) { host = undefined; void settingsChanged() } }, 'cost-meter: Command Code route')
  })
  ctx.inject(['web'], scope => {
    void settingsChanged()
    scope.effect(() => () => { webRelease?.(); webRelease = undefined; webIdentity = undefined }, 'cost-meter: Command Code search')
  })
  ctx.effect(() => () => { disposed = true; revision++; stop() }, 'cost-meter: Command Code teardown')
  async function snapshot() {
    await pending
    const data = runtime ? await runtime.snapshot() : { models: [], health: {}, servingAccountId: null }
    const searchProviders = getService(host, 'web')?.listProviders?.().search?.map(row => row.id) ?? []
    return { available: !!runtime, status, searchProviders, ...data }
  }
  return { settingsChanged, snapshot, async refreshModels(accountId) { await pending; await runtime?.refreshModels(accountId); return snapshot() } }
}
