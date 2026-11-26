const identifier = value => typeof value === 'string' && /^[\w.:/-]{1,160}$/.test(value)
  && !['__proto__', 'prototype', 'constructor'].includes(value)
const accountId = value => value === 'default' || typeof value === 'string' && /^[a-z0-9][a-z0-9-]{7,63}$/.test(value)
const label = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value)
const integer = (min, max) => value => Number.isSafeInteger(value) && value >= min && value <= max
const flag = value => typeof value === 'boolean'
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const arrayOf = (check, limit) => value => Array.isArray(value) && value.length <= limit && value.every(check) && new Set(value).size === value.length
const mapOf = check => value => record(value) && Object.keys(value).length <= 256
  && Object.entries(value).every(([key, entry]) => identifier(key) && check(entry))

export const COMMANDCODE_ORIGIN = 'https://api.commandcode.ai'
const schema = {
  enabled: [false, flag],
  preferredAccount: ['', value => value === '' || accountId(value)],
  inferenceAccounts: [['default'], arrayOf(accountId, 11)],
  modelAccounts: [{}, mapOf(accountId)],
  favorites: [[], arrayOf(identifier, 256)],
  favoritesOnly: [false, flag],
  modelVisibility: [{}, mapOf(flag)],
  modelNames: [{}, mapOf(label)],
  contextWindowOverrides: [{}, mapOf(integer(1, 10_000_000))],
  outputLimits: [{}, mapOf(integer(1, 1_000_000))],
  reasoningEfforts: [{}, mapOf(value => ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value))],
  zdr: [false, flag],
  webSearch: [false, flag],
  searchProvider: ['commandcode', identifier],
  protocol: ['auto', value => ['auto', 'cli', 'openai', 'messages'].includes(value)],
  requestTimeoutMs: [300_000, integer(1000, 3_600_000)],
  retryLimit: [3, integer(0, 10)],
  apiBase: [COMMANDCODE_ORIGIN, value => value === COMMANDCODE_ORIGIN],
}
export function validCommandCodeSettings(value) {
  return record(value) && Object.entries(value).every(([key, entry]) => Object.hasOwn(schema, key) && schema[key][1](entry))
}
export function normalizeCommandCodeSettings(value) {
  return Object.fromEntries(Object.entries(schema).map(([key, [fallback, check]]) => {
    const entry = value?.[key]
    return [key, structuredClone(check(entry) ? entry : fallback)]
  }))
}
