/** Restore daily amounts from complete recorded session rows, without repricing. */
const USAGE_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'calls']
const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0

export function repairDailySessionTotals(days) {
  const repaired = []
  for (const [date, day] of Object.entries(days ?? {})) {
    const rows = day?.sessions
    if (!Array.isArray(rows) || !rows.length || !(day.calls > 0)) continue
    const ids = new Set()
    const sums = Object.fromEntries([...USAGE_FIELDS, 'cost', 'apiCost'].map(key => [key, 0]))
    const models = new Map()
    let complete = true
    for (const row of rows) {
      if (!row?.id || ids.has(row.id)) { complete = false; break }
      ids.add(row.id)
      for (const key of Object.keys(sums)) {
        const value = key === 'apiCost' ? row.apiCost ?? row.cost : row[key] ?? 0
        if (!valid(value)) { complete = false; break }
        sums[key] += value
      }
      if (!complete || sums.apiCost > sums.cost + 1e-8) { complete = false; break }
      for (const [key, bucket] of Object.entries(row.byProviderModel ?? {})) {
        if (models.has(key) && models.get(key) === null) continue
        const sum = models.get(key) ?? Object.fromEntries(Object.keys(sums).map(field => [field, 0]))
        let usable = bucket !== null && typeof bucket === 'object'
        for (const field of Object.keys(sum)) {
          const value = field === 'apiCost' ? bucket?.apiCost ?? bucket?.cost : bucket?.[field] ?? 0
          if (!valid(value)) { usable = false; break }
          sum[field] += value
        }
        models.set(key, usable ? sum : null)
      }
    }
    // Anonymous usage or previously pruned details have a usage/call remainder.
    // Preserve that remainder and its money instead of inventing attribution.
    if (!complete || !Object.values(sums).every(valid) || !USAGE_FIELDS.every(key => valid(day[key] ?? 0) && sums[key] === (day[key] ?? 0))) continue
    let changed = Math.abs(sums.cost - (day.cost ?? 0)) > 1e-8 || Math.abs(sums.apiCost - (day.apiCost ?? day.cost ?? 0)) > 1e-8
    if (changed) { day.cost = sums.cost; day.apiCost = sums.apiCost }
    for (const [key, sum] of models) {
      const bucket = day.byProviderModel?.[key]
      if (!sum || !bucket || !sum.calls || !Object.values(sum).every(valid) || !USAGE_FIELDS.every(field => sum[field] === (bucket[field] ?? 0))) continue
      if (Math.abs(sum.cost - (bucket.cost ?? 0)) <= 1e-8 && Math.abs(sum.apiCost - (bucket.apiCost ?? bucket.cost ?? 0)) <= 1e-8) continue
      bucket.cost = sum.cost
      bucket.apiCost = sum.apiCost
      changed = true
    }
    if (changed) repaired.push(date)
  }
  return repaired
}
