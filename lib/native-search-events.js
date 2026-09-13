/** Shared, host-independent validation for the plugin's own metering records. */
export const NATIVE_SEARCH_USAGE_EVENT = 'cost-meter/native-search-usage'

export function isNativeSearchUsageEvent(event) {
  const data = event?.data
  return event?.type === NATIVE_SEARCH_USAGE_EVENT && data?.provider === 'deepseek-official'
    && typeof data.model === 'string' && /^deepseek-[a-z\d._:-]{1,120}$/i.test(data.model)
    && typeof data.requestId === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(data.requestId)
    && Number.isFinite(data.startedAtMs) && data.startedAtMs > 0
    && ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'].every(key => Number.isSafeInteger(data.usage?.[key]) && data.usage[key] >= 0)
}
