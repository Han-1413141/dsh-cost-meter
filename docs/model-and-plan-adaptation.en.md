# Model & Plan Adaptation Guide

Updated: 2026-10-28

The [October 28 update](catalog-2026-10-28.md) adds Kimi K3.1 Pro / Highspeed, MiniMax M3.1 Flash and current plan names. The [machine-readable plan catalog](subscription-catalog.json) lists the checked sources.

Current provider-scoped catalog, exact coverage, routing compatibility and limitations: [October 2026 pricing guide](provider-pricing-2026-10.md).

This document describes how dsh-cost-meter adapts **per-model billing** across vendors and **Coding Plan quotas** for subscriptions, including the matching mechanism and data sources. For the Chinese version see [`model-and-plan-adaptation.md`](./model-and-plan-adaptation.md).

---

## 1. Model billing adaptation

### 1.1 provider + model keyed billing

Price lookup was extended from model-only to **provider + model**:

- DeepSeek keeps using `prices.models` (peak/off-peak tiers plus `legacyBase` historical prices);
- non-DeepSeek providers use `prices.providers[provider].models[model]`;
- models with the same name under different providers never share prices; unconfigured models never silently fall back to the DeepSeek default price.

Supported billing buckets: `input` / `cacheMiss`, `cachedInput` / `cacheHit` / `cacheRead`, `cacheWrite`, `output`, `reasoning`. The two-tier shorthand (`input`/`output`) auto-fills cache prices; missing `cacheHit` falls back to `cacheMiss`.

### 1.2 Automatic model-name matching

Manual overrides (`priceOverrides`) take priority. Automatic matching accepts exact names, normalized equivalents, and date, version or context-length suffixes. In explicit non-DeepSeek routes, distinct models and variants remain unpriced until added to the table or assigned manually.

Normalization uses NFKC for full-width letters, digits, punctuation and composed character forms, then lowercases names. Unicode letters and numbers remain; spaces, hyphens, underscores and dots are ignored. Only known `(go)` / `(zen)` annotations are removed, including full-width parentheses; they can combine with date and other supported suffixes. Variant information such as `(mini)` or `(thinking)` remains part of the name. Auto mode accepts recognized upstream `vendor/model` and `vendor:model` spellings. Gemini also accepts the official [Models API](https://ai.google.dev/api/models) resource form `models/gemini-…`. Multiple NFKC-equivalent candidates remain ambiguous rather than being picked by order. Exact full-ID catalog entries and manual overrides take priority; `exact` mode does not enable aliases.

Explicit routes use their own prices. Historical zen/opencode IDs retain Go routing; PAYG Zen uses opencode-zen. Unknown proxies prefer exact-equivalent direct-API matches, but equally ranked cross-provider matches remain unpriced; name length never breaks a price tie. A declared vendor namespace cannot collapse into another vendor’s name. Scoped OpenRouter/Zen/Go catalogs, including legacy route aliases, never supply another route’s fallback price. Matched unpriced entries and local origins remain unpriced; the manual `__local__` zero-cost marker always wins. This matching update does not rewrite previously recorded ledger amounts.

Compatibility exception: a missing/DeepSeek provider still uses the DeepSeek default price when no entry matches; this is not a successful model recognition. Exact mode does not search foreign catalogs, so only auto mode can use a matched foreign unpriced entry to block that default fallback.

Examples:

| Model id in the request | Match result |
|---|---|
| `gpt5.6 luna(go)` | `gpt-5.6-luna` (normalized-equal) |
| `OpenAI : GPT 6.1 Sol` | `gpt-6.1-sol` in the direct `openai` route (recognized namespace) |
| `models/gemini-3.8-flash` | `gemini-3.8-flash` in the declared route (Google / Zen / Go prices stay distinct) |
| `gpt-6.1-sol (mini)` in `openai` | unpriced when no corresponding catalog entry exists |
| `DeepSeek V4 Flash` | `deepseek-v4-flash` (normalized-equal) |
| `deepseek-v4-flash-2026-08-01` | `deepseek-v4-flash` (date suffix stripped) |
| `deepseek-chat` and other legacy aliases | never guessed; falls back to the DeepSeek default price |

- Config `priceMatch`: `auto` (default) / `exact` (exact match only), switchable under Settings → Cost → Price table;
- The host ledger and the client estimate use the **same matching logic** (`matchModelId` in `lib/pricing.js` mirrored inside the bundle);
- **Manual pinning**: Settings lists "recently seen models without an exact match"; each can be pinned to any mounted entry (including cross-provider and the DeepSeek default price), stored in `priceOverrides` (highest priority, removable).

### 1.3 Built-in price catalog (170+ model IDs)

The built-in read-only catalog is grouped by **vendor → model family**, containing 20 third-party vendor/route keys plus the separate DeepSeek table:

| Vendor | Representative models |
|---|---|
| DeepSeek | V4 Flash / V4 Pro (peak/off-peak tiers + historical base price), V4 Flash Vision-Exp (experimental multimodal, priced at Flash parity) |
| OpenAI | GPT-6 Astra/Sol/Luna, GPT-6.1 Sol, GPT-5.6 Sol/Terra/Luna, GPT-5.5 (+Pro), 5.4 family, 5.3 Codex (+Spark), 5.2, 5.1 family, GPT-5, 4.1 |
| Anthropic | Fable 5.1/5, Opus 5.5/5/4.8/4.7/4.6, Sonnet 5.5/5/4.6, Haiku 5.5/4.5 |
| Google | Gemini 4 Argon / 3.8/3.7/3.6/3.5 Flash, 3.5 Flash Lite, 3.1 Pro, 3 Flash, 2.5 family |
| xAI | Grok 4.6/4.5/4.3, Grok Build |
| Z.ai / Zhipu | GLM-5.3/Flash, 5.2/5.1, 4.x |
| Alibaba Qwen | Qwen3.8 Max / Flash, 3.7, 3.6, 3.5 Plus |
| Kimi / Moonshot | K3.1 Pro / Highspeed, K3, K2.7 Code, K2.6, Kimi Code IDs |
| MiniMax | M3.1 Flash, M3, M2.7, M2.5 |
| Xiaomi MiMo | V2.6 (Pro / Flash / Pro UltraSpeed), V2.5 (+Pro, officially marked as retiring soon) |
| Tencent Hunyuan | Hy4 preview, Hy3 |
| OpenRouter / Mistral / NVIDIA / Upstage | common models; Mistral also resells `zai-glm-5-3-flash` and `deepseek-v4-1-flash-1017` at Mistral's own rates |
| **OpenCode Go (subscription)** | subscription reference prices, including Go-specific DeepSeek peak/off-peak tiers |

Price sources: cross-checked against each direct vendor's official API prices and the **separate OpenCode Zen/Go route price lists** (route prices may differ); entries without a verified complete billing rule (e.g. direct API GPT-5.5 Pro) are marked `unpriced` — **prices are never invented**. A machine-readable copy is [`provider-pricing.json`](./provider-pricing.json) (auto-generated from code).

### 1.4 Mounting

- **All catalog models are mounted by default** (since v1.5.2): `prices.providers` contains the whole built-in catalog (`unpriced` entries never get billed), and existing ledgers are topped up on load; **mounted ≠ shown directly** — mounting only makes billing available; direct display in the price table is controlled by the per-model toggle;
- **Mount** = copy a catalog entry into the billing price table so it immediately participates in billing; where it is shown is decided by the model's “Show directly in Cost settings” toggle (see below);
- **Unmount** (DeepSeek models only): revert to the default price; re-mounting is always available from the catalog;
- `unpriced` entries cannot be mounted;
- In the extended price catalog panel, each vendor section is **collapsed by default**; click a vendor to expand it. Mounted third-party models live inside the catalog by default, shown as editable cards (expand the vendor to edit prices / unmount);
- **“Show directly in Cost settings” toggle (per model)**: every mounted model in the catalog has its own toggle deciding whether its price card appears directly in the Cost settings price table; DeepSeek models default to direct display (each can be moved into the catalog), third-party models default to the catalog once mounted (each can be promoted to direct display). The toggle only decides placement — mounting and billing are unaffected.

---

## 2. Coding Plan quota adaptation

The "Coding Plan quotas" panel in Settings supports **12 vendors**, each with its own enable switch / key / manual refresh / progress bars and reset times, plus a per-vendor **display position** (sidebar card / Settings page / both / off, default Settings page; v1.5.26); official domains are used by default; MiniMax supports a [custom trusted HTTPS origin](minimax-quota-endpoint.md#english). The discovery chain is: panel key → DSH credential store → environment variables → CLI login fallback.

| Vendor | Endpoint | Shown as | Verified status |
|---|---|---|---|
| Anthropic Claude Pro/Max | `api.anthropic.com/api/oauth/usage` | 5-hour / 7-day window usage % | endpoint alive (401); auto-reads the OAuth token from `~/.claude/.credentials.json` |
| Z.ai / Zhipu GLM Coding Plan | `api.z.ai` and `open.bigmodel.cn` dual endpoints | per-window usage % | endpoints alive (401); handles both the `plans` array and flat-window responses |
| MiniMax Token Plan | `www.minimax.cn` first; configurable HTTPS origin | remaining token % | endpoints alive (1004 requires Authorization); legacy count-based endpoint fallback |
| Kimi / Moonshot | `api.moonshot.cn/v1/users/me/balance` | CNY balance text | endpoint alive (401); Kimi Code subscription windows alive (401), `api.kimi.com/coding/v1/usages` via `KIMI_CODING_API_KEY` + UA `KimiCLI/1.6` shows weekly/5h quotas (issue #53) |
| OpenRouter | `openrouter.ai/api/v1/credits` | prepaid credits used % | endpoint alive (401) |
| SiliconFlow | `api.siliconflow.cn/v1/user/info` | account balance text | endpoint alive (30014) |
| CommandCode | `api.commandcode.ai/alpha/billing/credits` | 5-hour/weekly window used % + monthly credits balance text | endpoint alive (401; issue #30); credential `COMMANDCODE_API_KEY` (`user_*`) |
| Cline Pass | `api.cline.bot/api/v1/users/me/plan/usage-limits` | 5-hour / weekly / monthly windows used % + reset times | endpoint alive (401; verified 2026-10); credential `CLINE_PASS_API_KEY` (`sk_*`); `percentUsed` is already a used percentage |
| SCNet Token Plan | — (no API endpoint; local metering) | monthly credits used % + usage text | the platform only offers `sk-tp-` inference endpoints; usage is console-only — estimated locally via the official deduction table |
| Volcano Ark Coding Plan | `open.volcengineapi.com` (`Action=GetUsageDetails`/`GetPersonalPlan`/`GetAFPUsage`, Version=2024-01-01, service=ark, region=cn-beijing, AK/SK HMAC) | 5-hour / weekly / monthly windows used % + reset times | control-plane requires IAM sub-user `ArkReadOnlyAccess`+`BillingCenterReadOnlyAccess`, credentials `VOLC_ACCESSKEY`/`VOLC_SECRETKEY` (issue #60); Lite≈5h1200/weekly9000/monthly18000, Pro 5× |

**SCNet local credits metering (issue #26)**: the SCNet (超算互联网) Token Plan is a credits-based monthly subscription (Basic 60,000 / Standard 240,000 / Pro 600,000) with no API-key quota endpoint — the plugin converts the current billing period's local-ledger usage into credits via the **official deduction table** (effective 2026-08-11, `SCNET_CREDIT_RATES`): cache-miss input = input+cacheWrite, cached input = cacheRead, output = output; covering major GLM/DeepSeek/Kimi/MiniMax/Qwen models. It shows a "used / total credits (est.)" text line and a monthly used-% bar. The billing period resets monthly from the configurable plan start date (`YYYY-MM-DD`; empty = calendar month). No credentials, no network — actual consumption is subject to the SCNet console; models not covered by the table are not counted.

Without credentials/subscription the panel shows a **neutral soft-failure hint** and never breaks other features. The panel is collapsed by default; the open/closed state is remembered via localStorage.

### New subscription attribution (2026-10-15)

The per-model billing selector now offers 18 families, separately from quota adapters. Added: Codex / ChatGPT, Volcengine Agent Plan, Tencent Coding Plan, Tencent Token Plan, and Baidu Qianfan Coding Plan. Explicit vendor and plan markers are required for inference; manual assignment or API overrides win. Generic OpenAI, Tencent and Baidu API providers are not subscriptions merely because they use the same models.

Go Plus shares Go's reference prices and attribution. The opencode-go-plus alias respects custom prices. Codex auto classification uses the saved Plan provider set; read-only quota can come from native DSH pi-ai OAuth or an installed subscription connector. The four new standalone plan families currently classify local tokens and equivalent cost; they do not invent remote quota percentages or reset windows.

Official sources: [Codex / ChatGPT](https://learn.chatgpt.com/docs/pricing), [Volcengine Agent Plan](https://docs.volcengine.com/docs/ark/agent-plan-personal-plan-overview?lang=zh), [Tencent's independent plans](https://cloud.tencent.com/document/product/1823/130103), [Baidu Qianfan](https://qianfan.cloud.baidu.com/qianfandev/topic/687754), [Go / Go Plus](https://opencode.ai/v2/docs/console/go/).

### Researched but not integrated (recorded as-is)

| Vendor / product | Reason |
|---|---|
| Gemini Code Assist | organization-level Cloud API only; no personal-key endpoint |
| GitHub Copilot (individual) | usage endpoints require the OAuth device flow, not supported yet |

If any of the above releases an API-key-based endpoint, it can be added cheaply within the adapter framework in `lib/coding-plans.js`.

---

## 2.5 Plan/API dual-track billing classification (issue #64, since v1.5.51)

The ledger records both the total equivalent cost (cost) and the real-money portion (apiCost) at day / session / byProviderModel level; budget, today-cost and overview cards count only the API portion, while subscription-quota consumption is presented as equivalents. Priority: **per-model override (planBilling.models[provider:model]) > raw-provider config (planBilling.providers[provider]) > Plan-family config > auto** (using the saved planBilling.autoProviders set). Raw-provider keys match the request provider exactly and can explicitly classify a custom route as plan/api. An auto value defers to the family configuration and saved automatic Plan set. Since 1.9.28, legacy configuration captures its prior classification once; later quota query/display switches do not change historical attribution. Explicitly assign newly added subscriptions to plan in billing settings. Official DeepSeek search and fetch request fees always remain API charges.

| Vendor | Default (auto) | Notes |
|---|---|---|
| anthropic / zai / minimax / commandcode / clinepass / scnet / volcengine | plan if saved in the automatic Plan set | percent-based subscription windows |
| kimi | plan if saved in the automatic Plan set | subscription windows; override models to api for PAYG balance scenarios |
| workbuddy / workbuddy-ai / workbuddy-global | plan if saved in the automatic Plan set | Domestic and international routes from both WorkBuddy connectors share the workbuddy family configuration; providers.workbuddy=plan also works explicitly |
| openrouter / siliconflow | api | credits/balance are real money |
| OpenCode Go (zen/opencode routes) | plan if saved in the automatic Plan set | Go-subscription models; Zen PAYG users should override to api |
| Codex (ChatGPT subscription) | saved Plan set or manual | Native pi-ai OAuth and subscription connector quotas; assign provider:model to plan in settings |

Per-1% quota and full-window token/equivalent-cost estimates are derived by diffing a **sampled percent history** (one sample per successful refresh, capped at 400 per vendor×window over 90 days); with insufficient samples they fall back to "current-period actual ÷ current used %". SCNet is a local credits self-estimate and does not participate in sampling.

The WorkBuddy international correction runs once at startup after upgrading. It updates historical daily and session API attribution using existing classification settings, preserving recorded amounts, prices, tokens and calls. Plan equivalents compare model usage; they do not represent credits actually charged by WorkBuddy. A free model can still have a nonzero API-equivalent amount.

## 3. Availability & compatibility guarantees

- **Ledger availability fallback**: state snapshots are self-checked against the strict codec before delivery; on drift the snapshot degrades step by step (drop catalog → empty quota state) to keep core features available instead of rejecting everything (both historical root causes of "ledger unavailable" — `reasoning: null` dirty data and catalog-entry schema mismatch — are fixed and covered by regression tests);
- **Config sanitization**: `sanitizeConfig` falls illegal config values back to defaults at the ledger load boundary;
- Tests: `node test/verify.mjs` covers billing math, the matching algorithm, catalog assertions, all 8 parsers plus SCNet local metering and Volcano Ark AK/SK flow, the official-domain whitelist, and a strict-codec drift sentinel.
