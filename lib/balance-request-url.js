export function hasRequestUserInfo(value) {
  if (typeof value !== 'string' || !value.includes('@')) return false
  try {
    const url = new URL(value, 'http://localhost')
    return Boolean(url.username || url.password)
  } catch { return false }
}

export function withoutRequestUserInfo(entry) {
  return hasRequestUserInfo(entry?.request?.url)
    ? { ...entry, enabled: false, request: { ...entry.request, url: '' } }
    : entry
}
