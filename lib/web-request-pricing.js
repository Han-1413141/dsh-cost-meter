/** Official Search/Fetch request fees, separate from model tokens and local HTTP fetches. */
export const WEB_REQUEST_PATHS = { '/v1/tools/search': 'search', '/v1/tools/fetch': 'fetch' }
export const WEB_REQUEST_RATE_CNY = 5 / 1000
// The standalone APIs continue to charge per successful request.
export const SERVER_SEARCH_BILLING_START = Date.parse('2026-11-01T00:00:00+08:00')
export const SERVER_SEARCH_BILLING_END = Date.parse('2026-11-18T12:00:00+08:00')
export const serverSearchRateCny = atMs => atMs >= SERVER_SEARCH_BILLING_START && atMs < SERVER_SEARCH_BILLING_END
  ? WEB_REQUEST_RATE_CNY : 0

// Old journals can contain the former rate after the cutoff. Keep those events
// readable and use the corrected rate whenever their costs are reconstructed.
export const requestFeeRateCny = (fee, atMs) => fee.source === 'server-tool' ? serverSearchRateCny(atMs) : fee.rateCny
export const requestFeeCostCny = (fee, atMs) => fee.requests * requestFeeRateCny(fee, atMs)
export const isWebRequestModel = (provider, model) => provider === 'deepseek-official' && ['deepseek-web-search', 'deepseek-web-fetch', 'deepseek-search-api', 'deepseek-fetch-api', 'deepseek-search-server'].includes(model)
export function matchesRequestFeeModel(model, fee) {
  return fee.source === 'server-tool' ? model === 'deepseek-search-server' && fee.kind === 'search'
    : [`deepseek-web-${fee.kind}`, `deepseek-${fee.kind}-api`].includes(model)
}
export function validRequestFee(fee, atMs) {
  if (!fee || !['search', 'fetch'].includes(fee.kind) || fee.requests !== 1) return false
  if (fee.source === 'server-tool') return fee.kind === 'search' && Number.isFinite(atMs)
    && (fee.rateCny === serverSearchRateCny(atMs)
      || atMs >= SERVER_SEARCH_BILLING_END && fee.rateCny === WEB_REQUEST_RATE_CNY)
  return fee.source === undefined && fee.rateCny === WEB_REQUEST_RATE_CNY
}
export function nativeServerSearchFees(value, atMs) {
  const ids = new Set(), out = []
  for (const block of Array.isArray(value?.content) ? value.content : []) {
    if (block?.type !== 'web_search_tool_result' || typeof block.tool_use_id !== 'string' || !block.tool_use_id || ids.has(block.tool_use_id)
      || !Array.isArray(block.content) || !block.content.some(row => row?.type === 'web_search_result' && typeof row.url === 'string' && row.url)) continue
    ids.add(block.tool_use_id)
    out.push({ model: 'deepseek-search-server', webSource: 'messages', requestFee: { kind: 'search', requests: 1, source: 'server-tool', rateCny: serverSearchRateCny(atMs) },
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } })
  }
  return out
}
export function webRequestUsage(value, path) {
  const kind = WEB_REQUEST_PATHS[path]
  if (!kind || !value || typeof value !== 'object' || value.error) return null
  if (kind === 'search' ? !Array.isArray(value.results) : typeof value.content !== 'string' || typeof value.title !== 'string') return null
  if (kind === 'search' ? value.results.length === 0 : !value.content.trim()) return { skipped: true }
  return { model: `deepseek-${kind}-api`, webSource: kind + '-api', requestFee: { kind, requests: 1, rateCny: WEB_REQUEST_RATE_CNY },
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } }
}
