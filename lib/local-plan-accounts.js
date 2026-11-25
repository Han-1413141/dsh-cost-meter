// Local plans have no per-account key endpoint. The provider saved on each ledger row is their attribution boundary.
export function validLocalPlanAccounts(rows) {
  const name = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 128 && !/[\x00-\x1f\x7f]/.test(value)
  return Array.isArray(rows) && rows.length <= 10 && rows.every(row => row && typeof row === 'object'
    && Object.keys(row).every(key => ['id', 'label', 'provider', 'planCredits', 'planStart', 'enabled'].includes(key))
    && typeof row.id === 'string' && /^[a-z0-9][a-z0-9-]{7,63}$/.test(row.id) && name(row.label) && name(row.provider) && !row.provider.includes(':')
    && typeof row.enabled === 'boolean' && Number.isFinite(row.planCredits) && row.planCredits > 0
    && (row.planStart === undefined || row.planStart === '' || typeof row.planStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.planStart) && new Date(row.planStart + 'T00:00:00Z').toJSON()?.slice(0, 10) === row.planStart))
    && new Set(rows.map(row => row.id)).size === rows.length && new Set(rows.map(row => row.provider)).size === rows.length
}

export function validQuotaReading(reading) {
  return reading && Number.isFinite(reading.remaining) && reading.remaining >= 0
    && (reading.total == null || Number.isFinite(reading.total) && reading.total > 0 && reading.total >= reading.remaining)
    && Number.isSafeInteger(reading.observedAt) && reading.observedAt > 0 && reading.observedAt <= 8640000000000000
}
