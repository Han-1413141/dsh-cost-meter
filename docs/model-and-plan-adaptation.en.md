# Model & Plan Adaptation Guide

Updated: 2026-08-18 (released with v1.5.0)

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

Unknown model ids are resolved in this order:

```
exact match → manual override (priceOverrides) → normalized-equal → containing match → strip date/version suffix → prefix (longest) → family-token similarity (≥2 leading tokens)
```

Normalization: lowercased; case / spaces / hyphens / underscores / dots are ignored, and bracketed annotations (e.g. `(go)`) are dropped. Containing match: a hit when the normalized request name **contains** a table model name (longest candidate wins; overly short candidates are skipped to prevent mis-matches). Router providers (opencode / zen etc., not registered in the price table) trigger a cross-vendor search over the whole catalog, with DeepSeek models keeping their peak/off-peak tiers.

Examples:

| Model id in the request | Match result |
|---|---|
| `gpt5.6 luna(go)` | `gpt-5.6-luna` (containing match) |
| `DeepSeek V4 Flash` | `deepseek-v4-flash` (normalized-equal) |
| `deepseek-v4-flash-2026-08-01` | `deepseek-v4-flash` (date suffix stripped) |
| `deepseek-chat` and other legacy aliases | never guessed; falls back to the DeepSeek default price |

- Config `priceMatch`: `auto` (default) / `exact` (exact match only), switchable under Settings → Cost → Price table;
- The host ledger and the client estimate use the **same matching logic** (`matchModelId` in `lib/pricing.js` mirrored inside the bundle);
- **Manual pinning**: Settings lists "recently seen models without an exact match"; each can be pinned to any mounted entry (including cross-provider and the DeepSeek default price), stored in `priceOverrides` (highest priority, removable).

### 1.3 Built-in price catalog (90+ models)

The built-in read-only catalog is grouped by **vendor → model family**, covering 14 vendors:

| Vendor | Representative models |
|---|---|
| DeepSeek | V4 Flash / V4 Pro (peak/off-peak tiers + historical base price) |
| OpenAI | GPT-5.6 Sol/Terra/Luna, GPT-5.5 (+Pro), 5.4 family, 5.3 Codex (+Spark), 5.2, 5.1 family, GPT-5, 4.1 |
| Anthropic | Fable 5, Opus 5/4.8/4.7/4.6, Sonnet 5/4.6, Haiku 4.5 |
| Google | Gemini 3.7/3.6/3.5 Flash, 3.5 Flash Lite, 3.1 Pro, 3 Flash, 2.5 family |
| xAI | Grok 4.6/4.5/4.3, Grok Build |
| Z.ai / Zhipu | GLM-5.3 (unpriced)/5.2/5.1 |
| Alibaba Qwen | Qwen3.8 Max, 3.7, 3.6, 3.5 Plus |
| Kimi / Moonshot | K3, K2.7 Code, K2.6, K2.5 |
| MiniMax | M3, M2.7, M2.5 |
| Xiaomi MiMo | V2.5 (+Pro) |
| Tencent Hunyuan | Hy3 |
| OpenRouter / Mistral / NVIDIA / Upstage | common models |
| **OpenCode Go (subscription)** | official reference prices for the **17 non-DeepSeek models** included in the subscription (DeepSeek V4 Flash/Pro follow the official main table and are not duplicated) |

Price sources: cross-checked against the **OpenCode Zen/Go official price list** (officially stated as cost-pass-through, identical to each vendor's own prices) and each vendor's official pricing pages; entries without a verifiable price (e.g. GLM-5.3) are marked `unpriced` — **prices are never invented**. A machine-readable copy is [`provider-pricing.json`](./provider-pricing.json) (auto-generated from code).

### 1.4 Mounting

- **All catalog models are mounted by default** (since v1.5.2): `prices.providers` contains the whole built-in catalog (`unpriced` entries never get billed), and existing ledgers are topped up on load; **mounted ≠ shown directly** — mounting only makes billing available; direct display in the price table is controlled by the per-model toggle;
- **Mount** = copy a catalog entry into the billing price table so it immediately participates in billing; where it is shown is decided by the model's “Show directly in Cost settings” toggle (see below);
- **Unmount** (DeepSeek models only): revert to the default price; re-mounting is always available from the catalog;
- `unpriced` entries cannot be mounted;
- In the extended price catalog panel, each vendor section is **collapsed by default**; click a vendor to expand it. Mounted third-party models live inside the catalog by default, shown as editable cards (expand the vendor to edit prices / unmount);
- **“Show directly in Cost settings” toggle (per model)**: every mounted model in the catalog has its own toggle deciding whether its price card appears directly in the Cost settings price table; DeepSeek models default to direct display (each can be moved into the catalog), third-party models default to the catalog once mounted (each can be promoted to direct display). The toggle only decides placement — mounting and billing are unaffected.

---

## 2. Coding Plan quota adaptation

The "Coding Plan quotas" panel in Settings supports **8 vendors**, each with its own enable switch / key / manual refresh / progress bars and reset times; credentials are only ever sent to each vendor's **hard-coded official domain** (whitelist asserted in tests). The discovery chain is: panel key → DSH credential store → environment variables → CLI login fallback.

| Vendor | Endpoint | Shown as | Verified status |
|---|---|---|---|
| Anthropic Claude Pro/Max | `api.anthropic.com/api/oauth/usage` | 5-hour / 7-day window usage % | endpoint alive (401); auto-reads the OAuth token from `~/.claude/.credentials.json` |
| Z.ai / Zhipu GLM Coding Plan | `api.z.ai` and `open.bigmodel.cn` dual endpoints | per-window usage % | endpoints alive (401); handles both the `plans` array and flat-window responses |
| MiniMax Token Plan | `minimaxi.com` / `minimax.io` dual domains | remaining token % | endpoints alive (1004 requires Authorization); legacy count-based endpoint fallback |
| Kimi / Moonshot | `api.moonshot.cn/v1/users/me/balance` | CNY balance text | endpoint alive (401); Kimi Code subscription windows have no public API-key endpoint yet |
| OpenRouter | `openrouter.ai/api/v1/credits` | prepaid credits used % | endpoint alive (401) |
| SiliconFlow | `api.siliconflow.cn/v1/user/info` | account balance text | endpoint alive (30014) |
| CommandCode | `api.commandcode.ai/alpha/billing/credits` | 5-hour/weekly window used % + monthly credits balance text | endpoint alive (401; issue #30); credential `COMMANDCODE_API_KEY` (`user_*`) |
| SCNet Token Plan | — (no API endpoint; local metering) | monthly credits used % + usage text | the platform only offers `sk-tp-` inference endpoints; usage is console-only — estimated locally via the official deduction table |

**SCNet local credits metering (issue #26)**: the SCNet (超算互联网) Token Plan is a credits-based monthly subscription (Basic 60,000 / Standard 240,000 / Pro 600,000) with no API-key quota endpoint — the plugin converts the current billing period's local-ledger usage into credits via the **official deduction table** (effective 2026-08-11, `SCNET_CREDIT_RATES`): cache-miss input = input+cacheWrite, cached input = cacheRead, output = output; covering major GLM/DeepSeek/Kimi/MiniMax/Qwen models. It shows a "used / total credits (est.)" text line and a monthly used-% bar. The billing period resets monthly from the configurable plan start date (`YYYY-MM-DD`; empty = calendar month). No credentials, no network — actual consumption is subject to the SCNet console; models not covered by the table are not counted.

Without credentials/subscription the panel shows a **neutral soft-failure hint** and never breaks other features. The panel is collapsed by default; the open/closed state is remembered via localStorage.

### Researched but not integrated (recorded as-is)

| Vendor / product | Reason |
|---|---|
| Alibaba Bailian Coding Plan | no public API-key usage endpoint yet (console only) |
| OpenAI Codex | usage is only tied to ChatGPT sessions; no standalone API-key endpoint |
| Gemini Code Assist | organization-level Cloud API only; no personal-key endpoint |
| GitHub Copilot (individual) | usage endpoints require the OAuth device flow, not supported yet |
| Kimi Code subscription weekly/5h windows | visible only in the kimi.com console (Kimi is integrated via PAYG balance) |

If any of the above releases an API-key-based endpoint, it can be added cheaply within the adapter framework in `lib/coding-plans.js`.

---

## 3. Availability & compatibility guarantees

- **Ledger availability fallback**: state snapshots are self-checked against the strict codec before delivery; on drift the snapshot degrades step by step (drop catalog → empty quota state) to keep core features available instead of rejecting everything (both historical root causes of "ledger unavailable" — `reasoning: null` dirty data and catalog-entry schema mismatch — are fixed and covered by regression tests);
- **Config sanitization**: `sanitizeConfig` falls illegal config values back to defaults at the ledger load boundary;
- Tests: `node test/verify.mjs` covers billing math, the matching algorithm, catalog assertions, all 7 parsers plus SCNet local metering, the official-domain whitelist, and a strict-codec drift sentinel.
