// Only billing metadata is retained from host events.
export function forkSeedLength(header) {
  const length = header?.seedLength
  return Number.isSafeInteger(length) && length > 0 ? length : 0
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
