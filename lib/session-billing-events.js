export const DS_BOT_USAGE_EVENT = 'cost-meter/ds-bot-usage'

// A v4 file stores the cut in the log. The persistence API can supply it directly.
export function sessionBillingHeader(id, header, inheritedEventCount) {
  const marker = { type: 'session', id, createdAt: header?.createdAt }
  if (typeof header?.isSeeded === 'boolean') marker.isSeeded = header.isSeeded
  if (typeof header?.parentSession === 'string' && header.parentSession) marker.parentSession = header.parentSession
  if (Number.isSafeInteger(header?.seedLength) && header.seedLength >= 0) marker.seedLength = header.seedLength
  if (Number.isSafeInteger(inheritedEventCount) && (inheritedEventCount > 0 || inheritedEventCount === 0 && marker.isSeeded !== undefined)) {
    marker.seedLength = inheritedEventCount
  }
  return marker
}

export function inheritedPrefixLength(header, records) {
  if (Number.isSafeInteger(header?.seedLength) && header.seedLength >= 0) return header.seedLength
  if (header?.isSeeded === false) return 0
  // Nested forks retain their ancestors' markers. An ordinary restart also writes
  // end-seed, but only the fork marker carries inherited: true.
  for (let i = records.length - 1; i >= 0; i--) {
    const row = records[i]
    if (row?.type === 'session/end-seed' && row.data?.inherited === true && Number.isSafeInteger(row.seq) && row.seq >= 0) return row.seq
  }
  return null
}

export function inheritedBoundaryRecord(row) {
  return row.data?.inherited === true ? { type: row.type, seq: row.seq, data: { inherited: true } } : null
}

export function attemptUsage(data) {
  if (data?.usage) return data.usage
  if (Array.isArray(data?.stream)) {
    for (let i = data.stream.length - 1; i >= 0; i--) {
      const chunk = data.stream[i]?.chunk
      if (chunk?.type === 'usage' && chunk.usage) return chunk.usage
    }
  }
  return null
}
