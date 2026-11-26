/**
 * Lightweight single-namespace host settings reader for DSH.
 *
 * Modern DSH's `settings.describe({ redactSecrets: true })` synchronously reads
 * profile YAML files from disk, composes layers, and serializes every active
 * plugin's Schemastery schema (`volatileForm` / `toJSON`). Calling it on every
 * RPC or every 1 second can saturate a CPU core on large `cordis.patch.yml`
 * installations (#586).
 *
 * Resolution order (read-only, non-secret fields only):
 *  1. Legacy/direct `settings.get(ns)` (DSH 0.2.0 or hosts exposing single-ns reads)
 *  2. Active Loader entry via `configEditor.entries()` (DSH 0.2.1+/0.2.2+/0.2.3+),
 *     unwrapping Cosmokit `Volatile` refs in memory with zero disk I/O or schema serialization
 *  3. Fallback `settings.describe({ redactSecrets: true })` shared across callers
 *     with a single re-entrancy guard and bounded 60-second TTL, retaining only
 *     the tiny parsed values (never full descriptors, schemas, or secrets).
 */

export const HOST_SETTINGS_CACHE_MAX_AGE_MS = 60_000
const MISSING_ENTRY_TTL_MS = 5_000
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')
const states = new WeakMap()

function isContext(ctx) {
  return ctx !== null && (typeof ctx === 'object' || typeof ctx === 'function')
}

function stateOf(ctx) {
  let state = states.get(ctx)
  if (!state) {
    state = {
      reading: false,
      locale: null,
      localeExpiresAt: 0,
      routeSpec: null,
      routeKey: null,
      route: null,
      routeExpiresAt: 0,
      entryCache: new Map(),
      missingUntil: new Map(),
    }
    states.set(ctx, state)
  }
  return state
}

/** Unwrap Cosmokit Volatile references without cloning unrelated config trees. */
export function unwrapVolatile(value) {
  let current = value
  for (let depth = 0; depth < 8 && current && typeof current === 'object' && VOLATILE_WRITE in current && typeof current.get === 'function'; depth++) {
    current = current.get()
  }
  return current
}

function isActiveEntry(entry) {
  return Boolean(entry?.fiber && entry.fiber.runtime !== null && (entry.fiber.state === undefined || entry.fiber.state === 2))
}

function rawConfigOf(entry) {
  const fiber = entry?.fiber
  if (!fiber) return undefined
  return fiber.effectiveConfig !== undefined ? fiber.effectiveConfig : fiber.config
}

/**
 * Read a single active plugin namespace directly from `configEditor.entries()`
 * without touching disk or running `settings.describe()`.
 */
function readDirectEntrySection(ctx, state, namespaces, force = false, missingTtl = MISSING_ENTRY_TTL_MS) {
  let configEditor
  try { configEditor = ctx?.get?.('configEditor') } catch { return { supported: false } }
  if (typeof configEditor?.entries !== 'function') return { supported: false }

  const now = Date.now()
  if (!force) {
    for (const ns of namespaces) {
      const cached = state.entryCache.get(ns)
      if (cached && cached.options?.id === ns && cached.fiber?.state === 2 && cached.fiber?.runtime !== null) {
        const raw = rawConfigOf(cached)
        if (raw !== undefined) return { supported: true, found: true, ns, section: unwrapVolatile(raw) }
      }
    }
    if (namespaces.every(ns => !state.entryCache.has(ns) && (state.missingUntil.get(ns) ?? 0) > now)) {
      return { supported: true, found: false }
    }
  }

  let entries
  try { entries = configEditor.entries() } catch { return { supported: false } }
  if (!Array.isArray(entries)) return { supported: false }

  let sawActiveWithConfig = false
  let sawActive = false
  const byNs = new Map()
  for (const entry of entries) {
    if (!isActiveEntry(entry)) continue
    sawActive = true
    const raw = rawConfigOf(entry)
    if (raw !== undefined) sawActiveWithConfig = true
    const id = entry.options?.id
    if (typeof id === 'string' && id.length > 0 && !byNs.has(id)) byNs.set(id, entry)
  }
  // If a future DSH renames both fiber.effectiveConfig and fiber.config, fall back safely.
  if (sawActive && !sawActiveWithConfig) return { supported: false }

  for (const ns of namespaces) {
    const entry = byNs.get(ns)
    if (!entry) {
      state.entryCache.delete(ns)
      state.missingUntil.set(ns, now + missingTtl)
      continue
    }
    state.missingUntil.delete(ns)
    if (entry.fiber.state === 2) state.entryCache.set(ns, entry)
    const raw = rawConfigOf(entry)
    if (raw === undefined) return { supported: false }
    return { supported: true, found: true, ns, section: unwrapVolatile(raw) }
  }
  return { supported: true, found: false }
}

/** Resolve an optional provider config without serializing the host configuration tree.
 * Host adapter/document events invalidate absent entries; explicit refresh can discover them immediately. */
export function readProviderProfileSection(ctx, namespace, force = false) {
  if (!isContext(ctx)) return undefined
  const settings = ctx.get?.('settings')
  if (typeof settings?.get === 'function') return unwrapVolatile(settings.get(namespace))
  const result = readDirectEntrySection(ctx, stateOf(ctx), [namespace], force, Infinity)
  return result.section
}

function normalizeLocale(value) {
  if (typeof value !== 'string') return null
  const language = value.trim().toLowerCase().split(/[-_]/)[0]
  return language === 'zh' || language === 'en' ? language : null
}

function extractRouteFields(ns, section, settingsPath) {
  let node = unwrapVolatile(section)
  for (const part of Array.isArray(settingsPath) ? settingsPath : []) {
    if (node === null || typeof node !== 'object') { node = undefined; break }
    node = unwrapVolatile(node[part])
  }
  const apiKeyEnv = node !== null && typeof node === 'object' ? unwrapVolatile(node.apiKeyEnv) : undefined
  const baseURL = node !== null && typeof node === 'object' ? unwrapVolatile(node.baseURL) : undefined
  return {
    ns,
    apiKeyEnv: typeof apiKeyEnv === 'string' && apiKeyEnv.length > 0 ? apiKeyEnv : undefined,
    baseURL: typeof baseURL === 'string' ? baseURL : undefined,
    failed: false,
  }
}

function parseRouteFromRows(rows, spec) {
  const descriptor = Array.isArray(rows)
    ? spec.namespaces.map(ns => rows.find(row => row?.ns === ns)).find(Boolean)
    : undefined
  if (!descriptor) return { ns: spec.namespaces[0], apiKeyEnv: undefined, baseURL: undefined, failed: false }
  return extractRouteFields(descriptor.ns, descriptor.value, spec.settingsPath)
}

function describeIntoState(settings, state, localeMaxAgeMs, routeSpec, routeMaxAgeMs) {
  state.reading = true
  try {
    // Read only the public, redacted descriptor; retain only parsed primitives/fields.
    const rows = settings?.describe?.({ redactSecrets: true })
    const now = Date.now()
    state.locale = normalizeLocale(Array.isArray(rows) ? rows.find(row => row?.ns === 'locale')?.value?.preference : undefined)
    state.localeExpiresAt = now + localeMaxAgeMs
    const activeRouteSpec = routeSpec ?? state.routeSpec
    if (activeRouteSpec) {
      state.route = parseRouteFromRows(rows, activeRouteSpec)
      state.routeKey = activeRouteSpec.routeKey
      state.routeExpiresAt = now + (routeMaxAgeMs ?? HOST_SETTINGS_CACHE_MAX_AGE_MS)
    }
  } catch (error) {
    const now = Date.now()
    state.locale = null
    state.localeExpiresAt = now + localeMaxAgeMs
    const activeRouteSpec = routeSpec ?? state.routeSpec
    if (activeRouteSpec) {
      state.route = { failed: true }
      state.routeKey = activeRouteSpec.routeKey
      state.routeExpiresAt = now + (routeMaxAgeMs ?? HOST_SETTINGS_CACHE_MAX_AGE_MS)
    }
    throw error
  } finally {
    state.reading = false
  }
}

export function isReadingHostSettings(ctx) {
  return Boolean(isContext(ctx) && states.get(ctx)?.reading)
}

/** describe() may itself emit settings/document-updated; do not recursively describe again. */
export function invalidateHostLocaleCache(ctx) {
  if (!isContext(ctx)) return true
  const state = states.get(ctx)
  if (state?.reading) return false
  if (state) {
    state.localeExpiresAt = 0
    state.entryCache.delete('locale')
    state.missingUntil.delete('locale')
  }
  return true
}

export function invalidateHostRouteCache(ctx, ns) {
  if (!isContext(ctx)) return true
  const state = states.get(ctx)
  if (state?.reading) return false
  if (state) {
    state.routeExpiresAt = 0
    if (typeof ns === 'string' && ns.length > 0) {
      state.entryCache.delete(ns)
      state.missingUntil.delete(ns)
    } else {
      for (const key of [...state.entryCache.keys()]) if (key !== 'locale') state.entryCache.delete(key)
      for (const key of [...state.missingUntil.keys()]) if (key !== 'locale') state.missingUntil.delete(key)
    }
  }
  return true
}

export function forgetHostSettings(ctx) {
  if (isContext(ctx)) states.delete(ctx)
}

export function readHostLocaleSetting(ctx, maxAgeMs = HOST_SETTINGS_CACHE_MAX_AGE_MS) {
  if (!isContext(ctx)) return null
  let settings
  try { settings = ctx?.get?.('settings') } catch { return null }
  if (!settings) return null

  if (typeof settings.get === 'function') {
    try {
      const section = unwrapVolatile(settings.get('locale'))
      return normalizeLocale(section !== null && typeof section === 'object' ? unwrapVolatile(section.preference) : undefined)
    } catch { return null }
  }

  const state = stateOf(ctx)
  const direct = readDirectEntrySection(ctx, state, ['locale'])
  if (direct.supported) {
    if (!direct.found || direct.section === null || typeof direct.section !== 'object') return null
    return normalizeLocale(unwrapVolatile(direct.section.preference))
  }

  if (state.reading || Date.now() < state.localeExpiresAt) return state.locale
  try {
    describeIntoState(settings, state, maxAgeMs, null, HOST_SETTINGS_CACHE_MAX_AGE_MS)
  } catch { /* state.locale already reset to null */ }
  return state.locale
}

export function readHostModelRouteSetting(ctx, namespaces, settingsPath = [], { force = false, maxAgeMs = HOST_SETTINGS_CACHE_MAX_AGE_MS } = {}) {
  const settings = ctx?.get?.('settings')
  if (typeof settings?.get === 'function') {
    for (const ns of namespaces) {
      const value = settings.get(ns)
      if (value !== undefined) {
        return { fast: true, legacy: true, ...extractRouteFields(ns, value, settingsPath) }
      }
    }
    return { fast: true, legacy: true, ns: namespaces[0], apiKeyEnv: undefined, baseURL: undefined, failed: false }
  }

  if (!isContext(ctx) || !settings) {
    return { fast: false, legacy: false, ns: namespaces[0], apiKeyEnv: undefined, baseURL: undefined, failed: false }
  }

  const state = stateOf(ctx)
  const direct = readDirectEntrySection(ctx, state, namespaces, force)
  if (direct.supported) {
    if (!direct.found) {
      return { fast: true, legacy: false, ns: namespaces[0], apiKeyEnv: undefined, baseURL: undefined, failed: false }
    }
    return { fast: true, legacy: false, ...extractRouteFields(direct.ns, direct.section, settingsPath) }
  }

  const normalizedPath = Array.isArray(settingsPath) ? settingsPath : []
  const routeKey = namespaces.join('\0') + '\x01' + normalizedPath.join('\0')
  const spec = { namespaces: [...namespaces], settingsPath: [...normalizedPath], routeKey }
  state.routeSpec = spec

  if (state.reading) {
    if (state.routeKey === routeKey && state.route && !state.route.failed) {
      return { fast: false, legacy: false, ...state.route }
    }
    return { fast: false, legacy: false, reentrant: true }
  }

  if (!force && state.routeKey === routeKey && state.route && Date.now() < state.routeExpiresAt) {
    if (state.route.failed) throw new Error('settings unavailable')
    return { fast: false, legacy: false, ...state.route }
  }

  describeIntoState(settings, state, HOST_SETTINGS_CACHE_MAX_AGE_MS, spec, maxAgeMs)
  return { fast: false, legacy: false, ...state.route }
}
