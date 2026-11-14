/** Lossless, bounded-depth deltas for immutable historical price catalogs. */
import { createHash } from 'node:crypto'

const records = new WeakMap()
const idPattern = /^[a-f\d]{64}$/
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const safe = key => typeof key === 'string' && !['__proto__', 'constructor', 'prototype'].includes(key)
const signature = record => createHash('sha256').update(JSON.stringify(record)).digest('hex')
const MAX_DEPTH = 24

export function freezePriceVersion(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) freezePriceVersion(child)
  return Object.freeze(value)
}

function diff(base, next, path = [], patches = []) {
  if (base === next) return patches
  if (object(base) && object(next)) {
    for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
      if (!safe(key)) continue
      if (!Object.hasOwn(next, key) || next[key] === undefined) {
        if (Object.hasOwn(base, key) && base[key] !== undefined) patches.push([[...path, key]])
      } else if (!Object.hasOwn(base, key)) patches.push([[...path, key], next[key]])
      else diff(base[key], next[key], [...path, key], patches)
    }
  } else if (JSON.stringify(base) !== JSON.stringify(next)) patches.push([path, next])
  return patches
}

function patched(base, path, patch) {
  if (!path.length) return patch[1]
  const [key, ...rest] = path, result = { ...base }
  if (rest.length) result[key] = patched(base?.[key], rest, patch)
  else if (patch.length === 1) delete result[key]
  else result[key] = patch[1]
  return result
}

function encode(value, versions, metadata, baseId) {
  const base = metadata.get(baseId)
  if (base && base.depth < MAX_DEPTH) {
    const record = { base: baseId, patch: diff(versions[baseId], value) }
    // Small deltas need no whole-catalog serialization just to compare sizes.
    // Full checkpoints still cap reconstruction at MAX_DEPTH.
    const size = JSON.stringify(record).length
    if (size < 1024 || size < JSON.stringify(value).length) return {
      record: freezePriceVersion(record), depth: base.depth + 1, signature: signature(record), baseValue: versions[baseId],
    }
  }
  return { record: value, depth: 0, signature: signature(value) }
}

export function rememberPriceVersion(versions, id, value, baseId) {
  const metadata = records.get(versions) ?? new Map()
  records.set(versions, metadata)
  if (!Object.hasOwn(versions, id)) versions[id] = freezePriceVersion(value)
  if (!metadata.has(id)) metadata.set(id, encode(versions[id], versions, metadata, baseId))
}

export function copyPriceVersions(versions = {}) {
  const result = { ...versions }
  records.set(result, new Map(records.get(versions) ?? []))
  return result
}

export function mergePriceVersions(local, disk) {
  const result = { ...disk, ...local }
  records.set(result, new Map([...(records.get(disk) ?? []), ...(records.get(local) ?? [])]))
  return result
}

export function encodePriceVersions(versions) {
  const metadata = records.get(versions) ?? new Map()
  records.set(versions, metadata)
  let previous
  for (const [id, value] of Object.entries(versions)) {
    const cached = metadata.get(id)
    if (!cached || (cached.record.base && cached.baseValue !== versions[cached.record.base])) {
      metadata.set(id, encode(value, versions, metadata, previous))
    }
    previous = id
  }
  return Object.fromEntries([...metadata].filter(([id]) => Object.hasOwn(versions, id)).map(([id, row]) => [id, row.record]))
}

/** Reuse already validated immutable versions when another process changes only usage. */
export function decodePriceVersions(raw, normalize, previous) {
  const versions = {}, metadata = new Map(), cached = records.get(previous), visiting = new Set()
  const load = id => {
    if (metadata.has(id)) return true
    if (!idPattern.test(id) || visiting.has(id) || visiting.size > MAX_DEPTH || !object(raw[id])) return false
    visiting.add(id)
    const record = raw[id]
    let base
    if (!object(record.prices)) {
      if (!idPattern.test(record.base) || !Array.isArray(record.patch) || record.patch.length > 100000
        || record.patch.some(patch => !Array.isArray(patch) || ![1, 2].includes(patch.length)
          || !Array.isArray(patch[0]) || patch[0].length > 16 || !patch[0].every(safe))
        || !load(record.base)) { visiting.delete(id); return false }
      base = metadata.get(record.base)
    }
    const fingerprint = signature(record), baseValue = base ? versions[record.base] : undefined
    const prior = cached?.get(id)
    if (prior && previous[id] && ((prior.sourceSignature === fingerprint && prior.sourceBase === baseValue)
      || (prior.signature === fingerprint && prior.baseValue === baseValue))) {
      versions[id] = previous[id]; metadata.set(id, prior)
    } else {
      let value = base ? versions[record.base] : record
      if (base) for (const patch of record.patch) value = patched(value, patch[0], patch)
      if (!object(value?.prices)) { visiting.delete(id); return false }
      versions[id] = freezePriceVersion(normalize(value))
      const clean = encode(versions[id], versions, metadata, base ? record.base : undefined)
      // Sanitized inputs can differ from the on-disk record until the first write.
      metadata.set(id, { ...clean, sourceSignature: fingerprint, sourceBase: baseValue })
    }
    visiting.delete(id)
    return true
  }
  for (const id of Object.keys(raw)) load(id)
  records.set(versions, metadata)
  // Legacy full catalogs compact once, before the first new file is written.
  if (![...metadata.values()].some(row => row.depth > 0)) {
    let previousId
    for (const id of Object.keys(versions)) {
      const { sourceSignature, sourceBase } = metadata.get(id)
      metadata.set(id, { ...encode(versions[id], versions, metadata, previousId), sourceSignature, sourceBase }); previousId = id
    }
  }
  return versions
}
