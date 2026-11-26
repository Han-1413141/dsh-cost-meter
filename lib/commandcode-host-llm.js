import { loadCommandCodeHostModule } from './commandcode-host-module.js'

export const { attributionHeaders, LlmAdapter, LlmError, ReasoningEffortId, errorChain,
  IMAGE_OFFLOAD_REQUIRED_CODE, offloadedImageText, projectOffloadedImages, requiredImageOffload,
  resolveRetryPolicy, textOnlyImageText, INVALID_CREDENTIAL_CODE, CONTEXT_WINDOW_EXCEEDED_CODE,
  isContextWindowExceededError, ProviderRequestId, ToolCallId } = await loadCommandCodeHostModule('dsh-llm')
if (![LlmAdapter, attributionHeaders, projectOffloadedImages, requiredImageOffload, resolveRetryPolicy, errorChain,
  textOnlyImageText, isContextWindowExceededError, offloadedImageText, ReasoningEffortId, ProviderRequestId, ToolCallId].every(value => typeof value === 'function')) {
  throw new Error('Command Code needs DSH 0.2.2-rc.1 or later with the attachment and provider API')
}
