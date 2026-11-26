// Generated from Mars-Sea/dsh-commandcode-provider 0.19.0. See LICENSE and NOTICE.
// src/web-search.ts
import { WebError } from "../commandcode-host-web.js";
import { attributionHeaders as attributionHeaders2 } from "../commandcode-host-llm.js";

// src/response-encoding.ts
var IDENTITY_ENCODING_HEADER = { "accept-encoding": "identity" };

// src/readable-error.ts
function readableErrorText(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error !== null && typeof error === "object") {
    const message = error.message;
    if (typeof message === "string" && message !== "") return message;
    try {
      return JSON.stringify(error);
    } catch {
      return Object.prototype.toString.call(error);
    }
  }
  return String(error);
}

// src/transport-failure.ts
var REASONS = {
  ECONNREFUSED: "连接被拒绝",
  ECONNRESET: "连接被重置",
  ENOTFOUND: "域名解析失败",
  EAI_AGAIN: "域名解析临时失败",
  EHOSTUNREACH: "主机不可达",
  ENETUNREACH: "网络不可达",
  ETIMEDOUT: "连接超时",
  UND_ERR_CONNECT_TIMEOUT: "连接超时",
  UND_ERR_SOCKET: "连接中断",
  UND_ERR_CLOSED: "连接已关闭",
  CERT_HAS_EXPIRED: "证书已过期",
  DEPTH_ZERO_SELF_SIGNED_CERT: "自签名证书不受信任",
  SELF_SIGNED_CERT_IN_CHAIN: "证书链中有自签名证书",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "无法验证证书"
};
function codeOf(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== "object") return void 0;
  const entry = value;
  if (typeof entry.code === "string" && entry.code !== "") return entry.code;
  if (Array.isArray(entry.errors)) {
    for (const nested of entry.errors) {
      const code = codeOf(nested, depth + 1);
      if (code !== void 0) return code;
    }
  }
  return codeOf(entry.cause, depth + 1);
}
function transportFailureReason(error) {
  const code = codeOf(error);
  if (code === void 0) return void 0;
  const reason = REASONS[code];
  return reason === void 0 ? `网络错误（${code}）` : `${reason}（${code}）`;
}
function httpOrigin(base) {
  try {
    const url = new URL(base);
    return `${url.protocol}//${url.host}`;
  } catch {
    return void 0;
  }
}

// src/provider-errors.ts
import { CONTEXT_WINDOW_EXCEEDED_CODE, isContextWindowExceededError } from "../commandcode-host-llm.js";

// src/llm-error.ts
import { LlmError } from "../commandcode-host-llm.js";

// src/accounts.ts
import { LlmError as LlmError2 } from "../commandcode-host-llm.js";
var MODEL_UNAVAILABLE_TTL_MS = 5 * 6e4;

// src/provider-errors.ts
var OUTPUT_LIMIT_REJECTION = new RegExp([
  "max_tokens:\\s*\\d+\\s*>\\s*\\d+",
  "maximum allowed number of output tokens",
  "invalid input[^\\n]*max_tokens",
  "expected number[^\\n]*at max_tokens"
].join("|"), "i");
var MAX_TRUSTED_RESET_MS = 30 * 24 * 60 * 60 * 1e3;

// src/stream-response.ts
import { LlmError as LlmError3, ProviderRequestId, ToolCallId, errorChain } from "../commandcode-host-llm.js";

// src/adapter.ts
import {
  attributionHeaders,
  LlmAdapter,
  LlmError as LlmError6,
  ReasoningEffortId,
  errorChain as errorChain2,
  IMAGE_OFFLOAD_REQUIRED_CODE,
  offloadedImageText,
  projectOffloadedImages,
  requiredImageOffload,
  resolveRetryPolicy,
  textOnlyImageText
} from "../commandcode-host-llm.js";

// src/api-key.ts
import { INVALID_CREDENTIAL_CODE, LlmError as LlmError4 } from "../commandcode-host-llm.js";

// src/image-request.ts
var REQUEST_IMAGE_MAX_ENCODED_BYTES = 1024 * 1024;

// src/image-tokens.ts
var DEEPSEEK_MIN_PIXELS = 544 * 544;

// src/plan-tiers.ts
var PLAN_TIER_ORDER = ["go", "goat", "pro", "provider", "max"];
var PLAN_ORDER = Object.fromEntries(
  PLAN_TIER_ORDER.map((tier, index) => [tier, index])
);

// src/capabilities.ts
var KNOWN_SUBSCRIPTION_PLANS = {
  "individual-go": { name: "Go", monthlyCredits: 10, tierWeight: 0 },
  // command-code@1.69.0 ("Go plan moves to per-model credits") added this second
  // Go row to the CLI's plan maps. Same display name and monthly total, so
  // `tierWeight` stays 0 alongside `individual-go` — exactly how the pre-existing
  // `individual-pro-v1` sits at Pro's weight 2. Resolution is longest-prefix
  // match (see below), so the explicit `-v1` suffix still wins over the base.
  "individual-go-v1": { name: "Go", monthlyCredits: 10, tierWeight: 0 },
  "individual-goat": { name: "GOAT", monthlyCredits: 70, tierWeight: 1 },
  "individual-pro": { name: "Pro", monthlyCredits: 30, tierWeight: 2 },
  "individual-pro-v1": { name: "Pro", monthlyCredits: 80, tierWeight: 2 },
  "individual-provider": { name: "Provider", monthlyCredits: 15, tierWeight: 3 },
  "individual-max": { name: "Max", monthlyCredits: 150, tierWeight: 4 },
  "individual-ultra": { name: "Ultra", monthlyCredits: 300, tierWeight: 4 },
  "teams-pro": { name: "Teams Pro", monthlyCredits: 40, tierWeight: 2 }
};
var SUBSCRIPTION_PLAN_PREFIXES = Object.keys(KNOWN_SUBSCRIPTION_PLANS).sort((a, b) => b.length - a.length);

// src/model-prices.ts
var MODEL_PRICE_ROWS = [
  { id: "claude-fable-5", rates: [10, 50, 1, 12.5], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "claude-fable-5-1", rates: [10, 50, 0.25, 12.5], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "claude-fable-5-2", rates: [8, 40, 0.2, 10], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "claude-haiku-4-5", rates: [1, 5, 0.1, 1.25], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "claude-haiku-5-5", rates: [0.1, 0.5, 0.01, 0.125], allowance: { go: 6, goat: 20, pro: 30 }, contextTiers: [{ "maxContext": 1e5, "rates": [0.1, 0.5, 0.01, 0.125] }, { "rates": [0.5, 2.5, 0.05, 0.625] }] },
  { id: "claude-opus-4-7", rates: [5, 25, 0.5, 6.25], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "claude-opus-4-8", rates: [5, 25, 0.5, 6.25], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "claude-opus-5", rates: [5, 25, 0.5, 6.25], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "claude-opus-5-5", rates: [4, 20, 0.2, 5], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "claude-sonnet-4-6", rates: [3, 15, 0.3, 3.75], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "claude-sonnet-5", rates: [2, 10, 0.2, 2.5], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "claude-sonnet-5-5", rates: [2, 10, 0.1, 2.5], allowance: { go: 6, goat: 10, pro: 20 } },
  { id: "deepseek-v4-flash", rates: [0.15, 0.6, 3e-3], peak: [0.3, 1.2, 6e-3], allowance: { go: 6, goat: 60, pro: 70 } },
  { id: "deepseek-v4-flash-fast", rates: [0.28, 0.56, 0.07], allowance: { go: 8, goat: 20, pro: 30 } },
  { id: "deepseek-v4-flash-vision-exp", rates: [0.15, 0.6, 3e-3], peak: [0.3, 1.2, 6e-3], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "deepseek-v4-pro", rates: [0.66, 1.98, 0.022], peak: [1.32, 3.96, 0.044], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "deepseek-v4.1-flash", rates: [0.15, 0.6, 3e-3], peak: [0.3, 1.2, 6e-3], allowance: { go: 10, goat: 100, pro: 110 } },
  { id: "deepseek-v4.1-flash-fast", rates: [0.16, 0.58, 0.016], peak: [0.32, 1.16, 0.032], allowance: { go: 6, goat: 60, pro: 70 } },
  { id: "deepseek-v4.1-flash-ultrafast", rates: [2.4, 9.6, 0.048], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "fugu-ultra", rates: [5, 30, 0.5], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "gemini-3.1-flash-lite", rates: [0.25, 1.5, 0.03], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "gemini-3.5-flash", rates: [1.5, 9, 0.15], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "gemini-3.5-flash-lite", rates: [0.3, 2.5, 0.03], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "gemini-3.6-flash", rates: [1.5, 7.5, 0.15], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "gemini-3.7-flash", rates: [1.5, 7.5, 0.15, 0.08334], allowance: { go: 6, goat: 40, pro: 50 } },
  { id: "gemini-3.8-flash", rates: [1.5, 7.5, 0.15], allowance: { go: 6, goat: 40, pro: 50 } },
  { id: "gemini-4-argon", rates: [2, 10, 0.1], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "gemini-4-carbon", rates: [2, 10, 0.1], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "glm-5", rates: [1, 3.2, 0.2], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "glm-5.1", rates: [1.4, 4.4, 0.26], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "glm-5.2", rates: [1.4, 4.4, 0.26], allowance: { go: 10, goat: 70, pro: 80 } },
  { id: "glm-5.2-fast", rates: [3, 10.25, 0.5], allowance: { go: 9, goat: 20, pro: 30 } },
  { id: "glm-5.3", rates: [1.4, 4.4, 0.26], allowance: { go: 10, goat: 70, pro: 80 } },
  { id: "glm-5.3-flash", rates: [0.15, 0.5, 0.03], allowance: { go: 10, goat: 100, pro: 110 } },
  { id: "glm-5.3-flashx", rates: [0.37, 1.25, 0.075], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "gpt-5.3-codex", rates: [2, 8, 0.5, 0], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "gpt-5.4", rates: [2.5, 15, 0.25, 0], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "gpt-5.4-mini", rates: [0.75, 4.5, 0.075, 0], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "gpt-5.5", rates: [5, 30, 0.5, 0], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "gpt-5.6-luna", rates: [0.2, 1.2, 0.02, 0.25], allowance: { go: 6, goat: 20, pro: 30 }, contextTiers: [{ "maxContext": 272e3, "rates": [0.2, 1.2, 0.02, 0.25] }, { "rates": [0.4, 1.8, 0.04, 0.5] }] },
  { id: "gpt-5.6-sol", rates: [5, 30, 0.5, 6.25], allowance: { go: 6, goat: 20, pro: 30 }, contextTiers: [{ "maxContext": 272e3, "rates": [5, 30, 0.5, 6.25] }, { "rates": [10, 45, 1, 12.5] }] },
  { id: "gpt-5.6-terra", rates: [2, 12, 0.2, 2.5], allowance: { go: 6, goat: 20, pro: 20 }, contextTiers: [{ "maxContext": 272e3, "rates": [2, 12, 0.2, 2.5] }, { "rates": [4, 18, 0.4, 5] }] },
  { id: "gpt-6-astra", rates: [10, 50, 1, 12.5], allowance: { go: 6, goat: 20, pro: 20 }, contextTiers: [{ "maxContext": 272e3, "rates": [10, 50, 1, 12.5] }, { "rates": [20, 75, 2, 25] }] },
  { id: "gpt-6-luna", rates: [0.1, 0.5, 0.01, 0.125], allowance: { go: 6, goat: 20, pro: 30 }, contextTiers: [{ "maxContext": 272e3, "rates": [0.1, 0.5, 0.01, 0.125] }, { "rates": [0.2, 0.75, 0.02, 0.25] }] },
  { id: "gpt-6-sol", rates: [2, 10, 0.2, 2.5], allowance: { go: 6, goat: 20, pro: 20 }, contextTiers: [{ "maxContext": 272e3, "rates": [2, 10, 0.2, 2.5] }, { "rates": [4, 15, 0.4, 5] }] },
  { id: "gpt-6.1-sol", rates: [2, 10, 0.1, 2.5], allowance: { go: 6, goat: 20, pro: 20 }, contextTiers: [{ "maxContext": 272e3, "rates": [2, 10, 0.1, 2.5] }, { "rates": [4, 15, 0.2, 5] }] },
  { id: "gpt-6.1-terra", rates: [1, 5, 0.05, 1.25], allowance: { go: 6, goat: 20, pro: 20 }, contextTiers: [{ "maxContext": 272e3, "rates": [1, 5, 0.05, 1.25] }, { "rates": [2, 7.5, 0.1, 2.5] }] },
  { id: "gpt-6.2-astra", rates: [8, 40, 0.4, 10], allowance: { go: 6, goat: 20, pro: 20 }, contextTiers: [{ "maxContext": 272e3, "rates": [8, 40, 0.4, 10] }, { "rates": [16, 60, 0.8, 20] }] },
  { id: "gpt-6.2-sol", rates: [2, 10, 0.1, 2.5], allowance: { go: 6, goat: 20, pro: 20 }, contextTiers: [{ "maxContext": 272e3, "rates": [2, 10, 0.1, 2.5] }, { "rates": [4, 15, 0.2, 5] }] },
  { id: "grok-4.5", rates: [2, 6, 0.5], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "grok-4.6", rates: [2, 6, 0.5], allowance: { go: 6, goat: 20, pro: 30 }, contextTiers: [{ "maxContext": 2e5, "rates": [2, 6, 0.5] }, { "rates": [4, 12, 1] }] },
  { id: "grok-4.7", rates: [2, 6, 0.5], allowance: { go: 6, goat: 20, pro: 30 }, contextTiers: [{ "maxContext": 2e5, "rates": [2, 6, 0.5] }, { "rates": [4, 12, 1] }] },
  { id: "inkling", rates: [1, 4.05, 0.17], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "inkling-small", rates: [0.5, 1.2, 0.1], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "kimi-k2.5", rates: [0.6, 3, 0.1], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "kimi-k2.6", rates: [0.95, 4, 0.16], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "kimi-k2.7-code", rates: [0.95, 4, 0.19], allowance: { go: 9, goat: 60, pro: 70 } },
  { id: "kimi-k2.7-code-highspeed", rates: [1.9, 8, 0.38], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "kimi-k3", rates: [3, 15, 0.3], allowance: { go: 8, goat: 20, pro: 30 } },
  { id: "kimi-k3.1-pro", rates: [2, 10, 0.2], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "ling-3.1-flash", rates: [0.3, 0.9, 0.06], allowance: { go: 6, goat: 100, pro: 110 } },
  { id: "ling-3.1-flash-1019", rates: [0.3, 0.9, 0.06], allowance: { go: 6, goat: 100, pro: 110 } },
  { id: "longcat-2.0", rates: [0.3, 1.2, 6e-3], allowance: { go: 10, goat: 50, pro: 60 } },
  { id: "mimo-v2.6-flash", rates: [0.14, 0.28, 28e-4], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "mimo-v2.6-pro", rates: [0.435, 0.87, 36e-4], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "mimo-v2.6-pro-ultraspeed", rates: [4.35, 8.7, 0.036], allowance: { go: 6, goat: 10, pro: 20 } },
  { id: "minimax-m2.5", rates: [0.3, 1.2, 0.03], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "minimax-m2.7", rates: [0.3, 1.2, 0.06], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "minimax-m3", rates: [0.3, 1.2, 0.06], listRates: [0.6, 2.4, 0.12], allowance: { go: 8, goat: 47, pro: 57 } },
  { id: "minimax-m3.1-flash", rates: [0.15, 0.6, 0.015], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "mistral-large-4", rates: [1.36, 4.18, 0.14], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "muse-ember", rates: [0.1, 0.5, 4e-3], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "muse-spark-1.1", rates: [1.25, 4.25, 0.15], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "muse-spark-1.2", rates: [1.25, 4.25, 0.15], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "muse-spark-1.2-contributor", rates: [0.1, 0.2, 2e-3], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "muse-spark-1.3", rates: [1.25, 4.25, 0.15], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "muse-spark-1.3-contributor", rates: [0.1, 0.2, 2e-3], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "muse-spark-open", rates: [1.25, 4.25, 0.15], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "muse-wonder-1.0", rates: [4, 20, 0.2], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "nemotron-3-ultra", rates: [0.6, 2.4, 0.12], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "nemotron-3.5-super-vl", rates: [0.2, 0.5, 0.04], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "ornith-1.5-122b", rates: [0.16, 0.64, 0.02], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "qwen-3.6-max", rates: [1.3, 7.8, 0.26, 1.63], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "qwen-3.6-plus", rates: [0.5, 3, 0.1], allowance: { go: 10, goat: 33, pro: 43 }, contextTiers: [{ "maxContext": 256e3, "rates": [0.5, 3, 0.1] }, { "rates": [2, 6, 0.2] }] },
  { id: "qwen-3.7-flash", rates: [0.03, 0.13, 6e-3, 0.038], allowance: { go: 6, goat: 20, pro: 30 }, contextTiers: [{ "maxContext": 32e3, "rates": [0.03, 0.13, 6e-3, 0.038] }, { "maxContext": 256e3, "rates": [0.1, 0.4, 0.02, 0.125] }, { "rates": [0.2, 0.8, 0.04, 0.25] }] },
  { id: "qwen-3.7-max", rates: [2.5, 7.5, 0.5, 3.13], allowance: { go: 10, goat: 33, pro: 43 } },
  { id: "qwen-3.7-plus", rates: [0.4, 1.6, 0.08, 0.5], allowance: { go: 10, goat: 33, pro: 43 }, contextTiers: [{ "maxContext": 256e3, "rates": [0.4, 1.6, 0.08, 0.5] }, { "rates": [1.2, 4.8, 0.24, 1.5] }] },
  { id: "qwen-3.8-27b", rates: [0.4, 3, 0.04], allowance: { go: 10, goat: 70, pro: 80 } },
  { id: "qwen-3.8-flash", rates: [0.16, 0.47, 0.016], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "qwen-3.8-max", rates: [2, 6, 0.25, 2.5], allowance: { go: 7, goat: 20, pro: 30 } },
  { id: "qwen-3.8-max-0902", rates: [2, 6, 0.25], allowance: { go: 7, goat: 20, pro: 30 } },
  { id: "qwen-3.8-max-prime", rates: [4, 12, 0.5, 5], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "qwen-3.8-omni-flash", rates: [0.15, 0.47, 0.016], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "qwen-4-max", rates: [1.5, 4.5, 0.075, 1.875], allowance: { go: 6, goat: 15, pro: 25 } },
  { id: "step-3.5-flash", rates: [0.09, 0.3, 0.02], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "step-3.7-flash", rates: [0.2, 1.15, 0.04], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "step-5-preview", rates: [1, 2.7, 0.05], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "tencent/hy3-paid", rates: [0.14, 0.58, 0.035], allowance: { go: 10, goat: 70, pro: 80 } },
  { id: "tencent/hy4", rates: [0.834, 2.501, 0.042], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "tencent/hy4-flash", rates: [0.07, 0.281, 3e-3], allowance: { go: 6, goat: 15, pro: 25 } },
  { id: "tencent/hy4-preview", rates: [0.834, 2.501, 0.042], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "typesafe/jev", rates: [0.042, 0, 0], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "typesafe/jev-1.14.0", rates: [0.042, 0, 0], allowance: { go: 6, goat: 20, pro: 30 } }
];
var ROWS_BY_SLUG = new Map(
  MODEL_PRICE_ROWS.map((row) => [row.id, row])
);
var KNOWN_SLUGS = new Set(ROWS_BY_SLUG.keys());

// src/gateway-facts.ts
import { LlmError as LlmError5 } from "../commandcode-host-llm.js";
var MODEL_CATALOG_TTL_MS = 5 * 6e4;

// src/adapter.ts
var COMMAND_CODE_CLI_VERSION = "1.89.3";
var BILLING_ACCESS_TTL_MS = 5 * 6e4;
var PROTOCOL_CACHE_TTL_MS = 15 * 6e4;
var REQUEST_IMAGE_MAX_BASE64_BYTES = 32 * 1024 * 1024;
var REQUEST_IMAGE_BYTE_QUANTUM = 16 * 1024 * 1024;
var REQUEST_IMAGE_RETRY_MAX_BASE64_BYTES = 8 * 1024 * 1024;
var REQUEST_IMAGE_RETRY_BYTE_QUANTUM = 8 * 1024 * 1024;
var THREAD_ID_NAMESPACE = Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex");

// src/web-search.ts
var COMMANDCODE_SEARCH_PROVIDER_ID = "commandcode";
var MIN_NUM_RESULTS = 1;
var MAX_NUM_RESULTS = 10;
var DEFAULT_NUM_RESULTS = 5;
var SEARCH_ROUTE = "/alpha/web-search";
var SEARCH_MAX_ATTEMPTS = 3;
var SEARCH_RETRY_BASE_DELAY_MS = 500;
var SEARCH_RETRY_JITTER_RATIO = 0.2;
function searchRetryDelayMs(attempt) {
  const base = SEARCH_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1);
  const jitter = 1 + (Math.random() * 2 - 1) * SEARCH_RETRY_JITTER_RATIO;
  return Math.round(base * jitter);
}
function searchRetryWait(delayMs, signal) {
  if (signal?.aborted === true) return Promise.reject(searchAborted(signal, signal.reason));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(searchAborted(signal, signal?.reason));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
function transportFailureMessage(error, apiBase, attempts, elapsedMs) {
  const origin = httpOrigin(apiBase);
  const details = [
    transportFailureReason(error),
    origin === void 0 ? void 0 : `目标 ${origin}`,
    `耗时 ${elapsedMs}ms`,
    `已尝试 ${attempts} 次`
  ].filter((detail) => detail !== void 0);
  return `Command Code web search request failed: ${readableErrorText(error)}（${details.join("；")}）`;
}
function clampNumResults(maxResults) {
  return maxResults === void 0 ? DEFAULT_NUM_RESULTS : Math.max(MIN_NUM_RESULTS, Math.min(MAX_NUM_RESULTS, Math.round(maxResults)));
}
function toSource(result) {
  const url = result.url?.trim();
  if (url === void 0 || url.length === 0) return void 0;
  const title = result.title?.trim();
  const snippet = result.snippet?.trim();
  return {
    url,
    ...title !== void 0 && title.length > 0 ? { title } : {},
    ...snippet !== void 0 && snippet.length > 0 ? { snippet } : {}
  };
}
function isAbortError(error) {
  return error instanceof DOMException && error.name === "AbortError";
}
function searchAborted(signal, fallback) {
  return new WebError("Command Code web search aborted", "WEB_ABORTED", {
    cause: signal?.aborted === true ? signal.reason : fallback
  });
}
function throwIfAborted(signal) {
  if (signal?.aborted === true) throw searchAborted(signal, void 0);
}
var CommandCodeSearchProvider = class {
  constructor(deps) {
    this.deps = deps;
  }
  deps;
  id = COMMANDCODE_SEARCH_PROVIDER_ID;
  /** Cheap local check; must not make network calls. Presence of a parseable base is enough. */
  available() {
    const base = this.deps.apiBase();
    return base.length > 0 && URL.canParse(base);
  }
  async search(request, signal) {
    throwIfAborted(signal);
    const apiBase = this.deps.apiBase();
    if (!URL.canParse(apiBase)) {
      throw new WebError(
        `Command Code web search is misconfigured: apiBase ${JSON.stringify(apiBase)} is not a valid URL`,
        "WEB_PROVIDER_ERROR"
      );
    }
    const key = await this.resolveKey(signal, apiBase);
    throwIfAborted(signal);
    const endpoint = `${apiBase.replace(/\/$/, "")}${SEARCH_ROUTE}`;
    const body = {
      query: request.query,
      numResults: clampNumResults(request.maxResults)
    };
    let response;
    let lastError;
    const startedAt = Date.now();
    for (let attempt = 1; attempt <= SEARCH_MAX_ATTEMPTS; attempt += 1) {
      throwIfAborted(signal);
      try {
        response = await (this.deps.fetchImpl ?? fetch)(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...IDENTITY_ENCODING_HEADER,
            Authorization: `Bearer ${key}`,
            "x-command-code-version": COMMAND_CODE_CLI_VERSION,
            "x-cli-environment": "production",
            ...attributionHeaders2()
          },
          body: JSON.stringify(body),
          ...signal !== void 0 ? { signal } : {}
        });
        break;
      } catch (error) {
        if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
        lastError = error;
        if (attempt === SEARCH_MAX_ATTEMPTS) break;
        await (this.deps.retryWait ?? searchRetryWait)(searchRetryDelayMs(attempt), signal);
      }
    }
    if (response === void 0) {
      throw new WebError(
        transportFailureMessage(lastError, apiBase, SEARCH_MAX_ATTEMPTS, Date.now() - startedAt),
        "WEB_PROVIDER_ERROR",
        { cause: lastError }
      );
    }
    if (!response.ok) {
      let message = `Command Code web search failed (HTTP ${response.status})`;
      try {
        const parsed = await response.json();
        const detail = typeof parsed === "object" && parsed !== null ? parsed?.error : void 0;
        if (typeof detail === "string" && detail.length > 0) message += `: ${detail}`;
        else if (typeof detail === "object" && detail !== null) {
          const code = detail?.code;
          const inner = detail?.message;
          if (typeof code === "string" || typeof inner === "string") {
            message += `: ${typeof code === "string" ? code : ""}${typeof code === "string" && typeof inner === "string" ? " — " : ""}${typeof inner === "string" ? inner : ""}`;
          }
        }
      } catch (error) {
        if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
        const text = await response.text().catch(() => "");
        const slice = text.trim().slice(0, 200);
        if (slice !== "") message += `: ${slice}`;
      }
      throw new WebError(message, "WEB_PROVIDER_ERROR");
    }
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
      throw new WebError("Command Code web search returned an unparseable response body", "WEB_PROVIDER_ERROR", { cause: error });
    }
    const results = payload?.results;
    if (!Array.isArray(results)) {
      throw new WebError(
        "Command Code web search returned no results array (the server may have rejected the query)",
        "WEB_PROVIDER_ERROR"
      );
    }
    const sources = [];
    const seen = /* @__PURE__ */ new Set();
    for (const item of results) {
      if (typeof item !== "object" || item === null) continue;
      const source = toSource(item);
      if (source === void 0 || seen.has(source.url)) continue;
      seen.add(source.url);
      sources.push(source);
    }
    return { sources, truncated: false };
  }
  async resolveKey(signal, apiBase) {
    let key;
    try {
      key = await this.deps.resolveKey(apiBase);
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
      if (error instanceof Error && typeof error.code === "string") {
        const code = error.code;
        if (code === "MISSING_CREDENTIAL") throw new WebError(error.message, "WEB_PROVIDER_CREDENTIAL_MISSING", { cause: error });
        if (code === "INVALID_CREDENTIAL" || code === "RATE_LIMIT") {
          throw new WebError(error.message, "WEB_PROVIDER_ERROR", { cause: error });
        }
      }
      throw new WebError(
        `Command Code web search credential resolution failed: ${readableErrorText(error)}`,
        "WEB_PROVIDER_ERROR",
        { cause: error }
      );
    }
    if (key === void 0 || key.length === 0) {
      throw new WebError(
        "Command Code web search has no API key; store COMMANDCODE_API_KEY through the credentials service (the web Models page writes it), export it in the launching environment, set config.apiKey, or run `command-code login` to write ~/.commandcode/auth.json",
        "WEB_PROVIDER_CREDENTIAL_MISSING"
      );
    }
    return key;
  }
};
export {
  CommandCodeSearchProvider
};
